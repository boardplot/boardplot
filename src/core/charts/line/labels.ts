import { spread1D, spread1DResult, sweepHide, warnSpreadOverflow } from '../../collide';
import { warnSliverLabels } from '../band/labels';
import { fitText } from '../../label/fitText';
import { lastActualIndex } from './marks';
import { readerFloorPx, textScaleOf } from '../../typeFloors';
import { DEFAULT_TARGET } from '../../target';
import { unitPrinted } from '../../frame';
import type { Point, Rect } from '../../geometry';
import { drawnStroke } from '../../curve';
import { polylineYAt, segmentHitsRect, sideAwayFrom } from '../../geometry';
import { preparePolyline, type PolylineQueries } from '../../polyline';
import { categoryLineAlign, rotatedClaimRect, yearRowRequests, type CategoryRowPlan } from '../../label/categoryRow';
import { SWATCH_RESERVE } from '../../label/emit';
import { PRIORITY, type LabelRequest, type SlotCandidate } from '../../label/solver';
import { resolveSubtitle } from '../../normalize/shared';
import { type FontSpec, type TextMeasurer } from '../../text';
import type { Id } from '../../types/cell';
import type { Category } from '../../types/data';
import type { LabelContent, LabelKind, SeriesLabelMode, ValueLabelMode } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import type { EndLabel, EndLabelSeed, NormSer } from './context';
import type { LineMarks } from './layout';
import { planNearZeroTails, type NearZeroTail } from './nearZero';
import type { LineInterpolation, LineOptions } from './types';
import { composedTextRole } from '../../textRole';
import { restValueHiding } from '../../restLabels';
import { noteName } from '../../calendarData';
import { partialKeyForced, saysToDate, toDateFits, toDateLabel } from '../../partialPeriod';
import { chartString } from '../../strings';
import type { Theme } from '../../types/theme';
import type { LineDomain, LineEnv, LineText } from './model';
import { maxOf, minOf, pushAll } from '../../arrays';

type LineVariant = 'line' | 'area' | 'stacked-area' | 'stacked100-area';
type ComposeText = (content: LabelContent, abs: number | null, pct: number | null, category: string, series: string, unitSuffix?: string, authoredPct?: boolean, source?: NormSer, categoryId?: Id) => string;
type PrintsZero = (abs: number, authoredPct?: boolean, source?: NormSer) => boolean;
type NameBlock = (text: string, seriesId?: Id) => { lines: string[]; w: number; h: number; title?: string; font?: FontSpec };

const BUMP_NAME_MAX_FRACTION = 0.18;
const BUMP_NAME_MAX_LINES = 2;
const ENDPOINT_LEADER_CLEARANCE = 4;
const ENDPOINT_LEADER_MIN_DY = 3;
const END_LABEL_MAX_DISPLACEMENT_LINES = 3;
const SLIVER_MIN_H = 10;
/** Air between a line's last point and the end-name column: a short leader, clear of the ring. */
const END_NAME_GAP = 16;
/**
 * A name places before the values at the same points: a value has
 * other seats around its point, a name has its one column or stretch.
 */
const NAME_PRIORITY = PRIORITY.endpoint + 1;

/** Internal second pass: a bounded end-label set that needs a key; 'inline' when it replaces authored inline names, which the pass drops. */
export const END_LABEL_KEY = Symbol('lineEndLabelKey');
export const END_LABEL_WIDE = Symbol('lineEndLabelWide');
/** The inline names stand in for end names that did not fit (layout.ts). */
export const INLINE_FALLBACK = Symbol('lineInlineFallback');
export const usesInlineFallback = (options: LineOptions): boolean => (options as LineOptions & { [INLINE_FALLBACK]?: boolean })[INLINE_FALLBACK] === true;
export const usesEndLabelKey = (options: LineOptions): boolean => (options as LineOptions & { [END_LABEL_KEY]?: true | 'inline' | 'range' })[END_LABEL_KEY] !== undefined;
/** A fan cut at its right edge runs on past its last reading: the key carries its last values. */
export const fanEdgeInKey = (domain: Pick<LineDomain, 'fan' | 'x' | 'options'>): boolean => domain.fan !== null && domain.x?.range?.cut.hi === true && usesEndLabelKey(domain.options);
export const usesWideEndLabels = (options: LineOptions): boolean => (options as LineOptions & { [END_LABEL_WIDE]?: boolean })[END_LABEL_WIDE] === true;

/**
 * Under a grey highlight on a plain line chart,
 * the focus series prints its name and its values bold, in its own ink. The
 * planner measures them bold, so each seat holds the bold text. Undefined
 * where the rule does not apply.
 */
export function lineFocusFont(
  env: { isBump: boolean; anyHighlight: boolean },
  domain: { variant: string; isArea: boolean; options: Pick<LineOptions, 'highlightMode'> },
  font: FontSpec,
  weight: number,
): FontSpec | undefined {
  return !env.isBump && env.anyHighlight && domain.variant === 'line' && !domain.isArea
    && domain.options.highlightMode !== 'fade' ? { ...font, weight } : undefined;
}

function areaLeaderGap(labelHeight: number): number {
  // The solver keeps 0.4 label heights clear and draws at least 0.6 heights.
  return Math.max(12, ENDPOINT_LEADER_CLEARANCE + Math.ceil(labelHeight) + 1);
}

const ENDPOINT_LABEL_GUTTER_MAX_FRACTION = 0.18;
const STACKED_AREA_GUTTER_MAX_FRACTION = 0.21;
const ENDPOINT_LABEL_MAX_LINES = 2;
export type EndpointLabelStrategy = 'full' | 'wrapped' | 'short' | 'legend';

interface EndpointLabelEconomy {
  strategy: EndpointLabelStrategy;
  maxGutterFraction: number;
  requiredGutter: number;
  appliedGutter: number;
  effectiveRequiredGutter: number;
  effectiveBudget: number;
  overflow: boolean;
}

export interface EndpointLabelPlan {
  inlineNamesEnabled: boolean;
  /** ['series'] when the names print at the ends, else null. */
  endContent: LabelContent | null;
  nameBlock: NameBlock;
  endLabels: EndLabel[];
  endSwatchReserve: number;
  endpointSwatches: boolean;
  /** Right margin the name column needs when it starts at the plot edge; the layout takes back what the last category's inset already holds. */
  endReserve: number;
  /** Air between the last point and the name column. */
  columnGap: number;
  endpointLabelEconomy?: EndpointLabelEconomy;
  endpointLegendFallback: boolean;
  /** Near-zero group receipt, present only when a group of series ends on a printed zero. */
  nearZeroTail?: NearZeroTail;
}

function wrapEndpointLabel(text: string, font: FontSpec, maxWidth: number, measure: TextMeasurer): { lines: string[]; w: number } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], w: 0 };
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(next, font).width > maxWidth) {
      lines.push(current);
      current = word;
      if (lines.length >= ENDPOINT_LABEL_MAX_LINES) return null;
    } else current = next;
  }
  if (current) lines.push(current);
  if (lines.length > ENDPOINT_LABEL_MAX_LINES) return null;
  return { lines, w: Math.max(...lines.map((line) => measure(line, font).width)) };
}

/**
 * The unit on the last value when neither the subtitle nor the host prints
 * it. A rank ladder and a rebased index print no unit (`unitless`).
 */
export function endUnitSuffix(options: LineOptions, unitless: boolean): string {
  return !unitless && options.unit && !unitPrinted({ subtitle: resolveSubtitle(options.subtitle), unit: options.unit, unitShown: options.unitShown })
    ? options.unit
    : '';
}

/**
 * The unit the printed values carry. A rank ladder prints its measure beside
 * rank ticks, so every value carries the unit there, whatever the subtitle
 * says; elsewhere the last value carries it when nothing else prints it.
 */
export function valueUnit(options: LineOptions, isBump: boolean, rebased: boolean): { endUnitSuffix: string; unitOnEvery: boolean } {
  return isBump ? { endUnitSuffix: options.unit ?? '', unitOnEvery: true } : { endUnitSuffix: endUnitSuffix(options, rebased), unitOnEvery: false };
}

/**
 * An authored cell label with `${value}` filled in. The token is the cell's
 * own number through the shared formatter, never the text the configured
 * label content happens to compose: an end label under `labels: { series:
 * ['series'] }` and a point label under `labels: { point: ['series'] }` both
 * carry the series name and no number, so "Latest ${value}" rendered as
 * "Latest " on the one and "Latest Coverage" on the other.
 */
function authoredCellText(override: string, value: {
  composeText: ComposeText;
  variant: LineVariant;
  abs: number | null;
  pct: number | null;
  isPct: boolean;
  unitSuffix: string;
  source: NormSer | undefined;
  categoryId: Id;
}): string {
  const number = value.composeText(
    value.variant === 'stacked100-area' ? ['percent'] : ['absolute'],
    value.abs, value.pct, '', '', value.unitSuffix, value.isPct, value.source, value.categoryId,
  );
  return override.replace(/\$\{value\}/g, number);
}

/**
 * One name per series at its last point. The name never carries a value:
 * the value, when valueLabels asks for it, sits at the point. The value is
 * still composed here, because the near-zero group joins the series that end
 * on the same printed zero.
 */
function buildEndpointSeeds(input: {
  endUnitSuffix: string;
  /** The content of the printed values; its number parts decide the near-zero group's zero. */
  valueContent: LabelContent;
  drawnSeries: NormSer[];
  cats: Category[];
  lastIdxOf: Map<Id, number>;
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  rebased: boolean;
  variant: LineVariant;
  absOf: (series: NormSer, categoryIndex: number) => number | null;
  composeText: ComposeText;
  printsZero: PrintsZero;
  labelOnly: ReadonlySet<Id> | undefined;
  /** stacked100-area categories whose shares are of the known parts only: not printed. */
  sharesWithheld: ReadonlySet<Id>;
}): EndLabelSeed[] {
  const { endUnitSuffix, drawnSeries, cats, lastIdxOf, pv, rowOf, rebased, variant, absOf, composeText, printsZero, labelOnly } = input;
  const valueParts = input.valueContent.filter((part): part is 'absolute' | 'percent' => part === 'absolute' || part === 'percent');
  const seeds: EndLabelSeed[] = [];
  drawnSeries.forEach((series, dataIdx) => {
    // `seriesLabels: { only }` names the series that carry a direct label:
    // twelve curves, four names, and the rest read off the ramp.
    if (labelOnly !== undefined && !labelOnly.has(series.id)) return;
    const ci = lastIdxOf.get(series.id);
    if (ci === undefined) return;
    const plotted = pv[rowOf.get(series)!]![ci]!;
    const abs = rebased ? plotted : absOf(series, ci);
    const pct = variant === 'stacked100-area' && !input.sharesWithheld.has(cats[ci]!.id) ? plotted : null;
    const source = rebased ? undefined : series.vals[ci]?.format ? { ...series, format: series.vals[ci]!.format } : series;
    const compose = (content: LabelContent, seriesLabel: string): string =>
      composeText(content, abs, pct, cats[ci]!.label ?? cats[ci]!.id, seriesLabel, endUnitSuffix, series.vals[ci]!.isPct, source, cats[ci]!.id);
    seeds.push({
      id: `series:${series.id}`,
      kind: 'series',
      compose,
      s: series,
      dataIdx,
      ci,
      fullText: series.label,
      ...(series.shortLabel ? { shortText: series.shortLabel } : {}),
      valueText: typeof series.vals[ci]!.labelOverride === 'string'
        ? authoredCellText(series.vals[ci]!.labelOverride as string, { composeText, variant, abs, pct, isPct: series.vals[ci]!.isPct, unitSuffix: endUnitSuffix, source, categoryId: cats[ci]!.id })
        : series.vals[ci]!.labelOverride === false ? '' : compose(valueParts, ''),
      zeroText: composeText(valueParts, 0, 0, '', '', endUnitSuffix, false, source),
      // Every printed part is zero at its precision: the absolute value by
      // its raw number, a share by its printed text.
      printsZero: valueParts.length > 0 && valueParts.every((part) => part === 'absolute'
        ? abs !== null && printsZero(abs, series.vals[ci]!.isPct, source)
        : pct !== null && (pct === 0 || composeText(['percent'], abs, pct, '', '', '', series.vals[ci]!.isPct, source, cats[ci]!.id) === composeText(['percent'], 0, 0, '', '', '', false, source))),
      exactZero: abs === 0,
    });
  });
  return seeds;
}

function toEndLabel(seed: EndLabelSeed, text: string, lines: string[], width: number, labelH: number): EndLabel {
  return { id: seed.id, kind: seed.kind, ...(seed.shared ? { shared: true as const } : {}), s: seed.s, dataIdx: seed.dataIdx, ci: seed.ci, text, w: width, lines, h: Math.max(1, lines.length) * labelH, ...(seed.valueText ? { valueText: seed.valueText } : {}) };
}

function oneLineLabels(seeds: EndLabelSeed[], textOf: (seed: EndLabelSeed) => string, labelFont: FontSpec, labelH: number, measure: TextMeasurer): EndLabel[] {
  return seeds.flatMap((seed) => {
    const text = textOf(seed);
    return text ? [toEndLabel(seed, text, [text], measure(text, labelFont).width, labelH)] : [];
  });
}

function wrappedLabels(seeds: EndLabelSeed[], textOf: (seed: EndLabelSeed) => string, labelFont: FontSpec, labelH: number, maxWidth: number, measure: TextMeasurer): EndLabel[] | null {
  const labels: EndLabel[] = [];
  for (const seed of seeds) {
    const text = textOf(seed);
    if (!text) continue;
    const block = wrapEndpointLabel(text, labelFont, maxWidth, measure);
    if (!block) return null;
    labels.push(toEndLabel(seed, text, block.lines, block.w, labelH));
  }
  return labels.some((label) => label.lines.length > 1) ? labels : null;
}

export function prepareEndpointLabels(input: {
  options: LineOptions;
  names: SeriesLabelMode;
  valueContent: LabelContent;
  mergeEndValues?: boolean;
  /** What sits right of the last point: its value's half width or the latest-point ring, plus air. */
  endRoom: number;
  labelOnly: ReadonlySet<Id> | undefined;
  variant: LineVariant;
  isBump: boolean;
  isArea: boolean;
  drawnSeries: NormSer[];
  cats: Category[];
  lastIdxOf: Map<Id, number>;
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  rebased: boolean;
  absOf: (series: NormSer, categoryIndex: number) => number | null;
  composeText: ComposeText;
  printsZero: PrintsZero;
  heroMode: boolean;
  anyHighlight: boolean;
  size: { width: number };
  labelFont: FontSpec;
  labelH: number;
  measure: TextMeasurer;
  sharesWithheld: ReadonlySet<Id>;
  /**
   * the width a rank ladder's two name columns share, measured
   * together: the canvas less the rank axis, the column air and the plot at
   * its comfortable band step. A name wraps only when it needs more than its
   * half of it, or than 18% of the canvas where that is more.
   */
  bumpNameRoom?: number;
  /** The start names gave way, so the end column may take both columns' share. */
  bumpOneColumn?: boolean;
  /** values folded into a bump name, keyed by the value's label id. */
  bumpFolded?: ReadonlyMap<string, string>;
  /** The story names print bold, so they are measured bold. */
  bumpStory?: { ids: ReadonlySet<Id>; font: FontSpec };
}): EndpointLabelPlan {
  const { options, isBump, isArea, size, labelFont, labelH, measure } = input;
  const endContent: LabelContent | null = input.names === 'end' ? ['series'] : null;
  const built = endContent ? buildEndpointSeeds({ ...input, endUnitSuffix: endUnitSuffix(options, isBump || input.rebased) }) : [];
  const nearZero = planNearZeroTails({
    strings: options.strings,
    seeds: built,
    endContent,
    pinned: (id) => options.labelPlacements?.[id] !== undefined,
  });
  const seeds = nearZero.seeds;
  // A name steps down to the target's label floor before it is cut.
  const nameFloor = readerFloorPx(options.target ?? DEFAULT_TARGET, 'label', textScaleOf(options));
  const fitName = (text: string, cap: number, nameFont: FontSpec = labelFont) => {
    const wrapped = fitText(text, nameFont, cap, BUMP_NAME_MAX_LINES, measure, { target: options.target, textScale: textScaleOf(options), typeRole: 'label', ...(nameFloor < nameFont.size ? { shrink: { ...nameFont, size: nameFloor } } : {}) });
    const lines = wrapped.lines.length > 0 ? wrapped.lines : [text];
    const font = wrapped.lines.length > 0 && wrapped.font.size < nameFont.size ? wrapped.font : undefined;
    const widest = Math.max(...lines.map((line) => measure(line, font ?? nameFont).width));
    return { lines, w: Math.min(widest, cap), h: lines.length * (font ? labelH * font.size / labelFont.size : labelH), ...(wrapped.title !== undefined ? { title: wrapped.title } : {}), ...(font ? { font } : {}) };
  };
  const nameBlock: NameBlock = (text, seriesId) => {
    if (!isBump) return { lines: [text], w: measure(text, labelFont).width, h: labelH };
    const nameFont = seriesId !== undefined && input.bumpStory?.ids.has(seriesId) ? input.bumpStory.font : labelFont;
    const cap = Math.max(size.width * BUMP_NAME_MAX_FRACTION, (input.bumpNameRoom ?? 0) / 2);
    const block = fitName(text, cap, nameFont);
    if (!input.bumpOneColumn || block.title === undefined) return block;
    // One name column may take the start column's room, but only where that
    // removes a cut; a name cut either way keeps the narrow column and the frame's width.
    const wide = fitName(text, Math.max(size.width * BUMP_NAME_MAX_FRACTION * 2, input.bumpNameRoom ?? 0), nameFont);
    return wide.title === undefined ? wide : block;
  };
  // A plain line's grey context lines differ by
  // lightness and marker shape, and each name prints in its line's ink, so the
  // names under a highlight need no swatch. Hero lines keep theirs.
  const endpointSwatches = !isBump && !isArea && (input.heroMode || input.anyHighlight && !(input.variant === 'line' && options.highlightMode !== 'fade'));
  const endSwatchReserve = isArea || endpointSwatches ? SWATCH_RESERVE : 0;
  const effectiveWidth = typeof options.embed?.width === 'number' && options.embed.width > 0 ? options.embed.width : size.width;
  const effectiveScale = effectiveWidth / size.width;
  // A stacked area names its bands at their ends with up to 21% of the
  // canvas before it falls back to the key row; its swatch and leader gap take more room.
  const effectiveBudget = effectiveWidth * (input.variant === 'stacked-area' ? STACKED_AREA_GUTTER_MAX_FRACTION : ENDPOINT_LABEL_GUTTER_MAX_FRACTION);
  const svgBudget = effectiveBudget / effectiveScale;
  const endpointPadding = isArea ? areaLeaderGap(labelH * ENDPOINT_LABEL_MAX_LINES) + 8 : 14;
  const textBudget = Math.max(0, svgBudget - endSwatchReserve - endpointPadding);
  const full = oneLineLabels(seeds, (seed) => seed.fullText, labelFont, labelH, measure);
  const fullWrapped = wrappedLabels(seeds, (seed) => seed.fullText, labelFont, labelH, textBudget, measure);
  const hasShort = seeds.some((seed) => seed.shortText !== undefined);
  const short = hasShort ? oneLineLabels(seeds, (seed) => seed.shortText ?? seed.fullText, labelFont, labelH, measure) : null;
  const shortWrapped = hasShort ? wrappedLabels(seeds, (seed) => seed.shortText ?? seed.fullText, labelFont, labelH, textBudget, measure) : null;
  const legendPosition = typeof options.legend === 'object' ? options.legend.position : options.legend;
  const gridLegend = (options as LineOptions & { gridEndpointIdentity?: unknown }).gridEndpointIdentity === 'legend';
  const legendAllowed = !isBump && endContent !== null && legendPosition !== 'none' && legendPosition !== 'right' && !seeds.some((seed) => options.labelPlacements?.[seed.id] !== undefined);
  // The key row names the series instead, so the ends carry nothing.
  const legend: EndLabel[] | null = legendAllowed || gridLegend ? [] : null;
  const candidates: { strategy: EndpointLabelStrategy; labels: EndLabel[] }[] = [
    { strategy: 'full', labels: full },
    ...(fullWrapped ? [{ strategy: 'wrapped' as const, labels: fullWrapped }] : []),
    ...(legendPosition !== 'none' && short ? [{ strategy: 'short' as const, labels: short }] : []),
    ...(legendPosition !== 'none' && shortWrapped ? [{ strategy: 'short' as const, labels: shortWrapped }] : []),
    ...(legend ? [{ strategy: 'legend' as const, labels: legend }] : []),
  ];
  const gutter = (labels: EndLabel[]) => labels.length > 0 ? maxOf(labels.map((label) => label.w)) + endSwatchReserve + (isArea ? areaLeaderGap(maxOf(labels.map((label) => label.h))) + 8 : endpointPadding) : 0;
  const chosen = usesEndLabelKey(options) ? { strategy: 'legend' as const, labels: [] as EndLabel[] } : gridLegend && legend ? { strategy: 'legend' as const, labels: legend } : candidates.find((candidate) => gutter(candidate.labels) <= svgBudget + 1e-9)
    // None fits and the key is barred: the narrowest names cost the plot least.
    ?? candidates.reduce((best, candidate) => gutter(candidate.labels) < gutter(best.labels) ? candidate : best);
  const endLabels = isBump
    ? full.map((label) => ({ ...label, ...foldBumpValue(label.text, input.bumpFolded?.get(`point:${label.s.id}:${input.cats[label.ci]!.id}`), (text) => nameBlock(text, label.s.id)) }))
    : chosen.labels;
  const nameGutter = gutter(endLabels);
  // The name column starts just past the line ends, clear of what sits right
  // of the last point, so its leaders stay short. A rank ladder keeps its
  // names beside the plot, level with the start names on the other side.
  const columnGap = isBump ? 6 : Math.max(isArea ? areaLeaderGap(Math.max(0, maxOf(endLabels.map((label) => label.h)))) : END_NAME_GAP, input.endRoom);
  const endReserve = isBump || endLabels.length === 0 ? nameGutter : maxOf(endLabels.map((label) =>
    usesWideEndLabels(options) && input.mergeEndValues && label.valueText && !label.shared
      ? Math.max(label.w, measure(`${label.text} `, labelFont).width + measure(label.valueText, labelFont).width) : label.w)) + endSwatchReserve + columnGap + 8;
  const economy = !isBump && seeds.length > 0 ? { strategy: chosen.strategy, maxGutterFraction: ENDPOINT_LABEL_GUTTER_MAX_FRACTION, requiredGutter: nameGutter, appliedGutter: nameGutter, effectiveRequiredGutter: nameGutter * effectiveScale, effectiveBudget, overflow: nameGutter > svgBudget + 1e-9 } : undefined;
  return { inlineNamesEnabled: input.names === 'inline', endContent, nameBlock, endLabels, endSwatchReserve, endpointSwatches, endReserve, columnGap, ...(economy ? { endpointLabelEconomy: economy } : {}), ...(nearZero.tail ? { nearZeroTail: nearZero.tail } : {}), endpointLegendFallback: economy?.strategy === 'legend' || economy?.strategy === 'short'
    // A dropped zero group takes its names off the canvas. Without the legend
    // an exhibit made only of those series draws anonymous lines: the footnote
    // states a count and a value and nothing says which line is which. Only
    // 'auto' falls back: an explicit 'none' or position is the author's call.
    || (nearZero.tail?.mode === 'dropped' && legendPosition === undefined) };
}

/**
 * a bump value with no free seat at a point its name stands beside
 * reads in the name, "Name · 19%", as a tie's value reads in its note, when
 * the name's fitted lines print the value whole. Otherwise the name stands
 * alone and the value stays owed to the note line.
 */
export function foldBumpValue(name: string, value: string | undefined, nameBlock: NameBlock): { text: string } & ReturnType<NameBlock> {
  const folded = value === undefined ? undefined : `${name} · ${value}`;
  const block = folded === undefined ? undefined : nameBlock(folded);
  return block && block.lines.join(' ').includes(`· ${value}`) ? { text: folded!, ...block } : { text: name, ...nameBlock(name) };
}

/**
 * A computed value's seats beside its point, over or under it to the left or
 * right, after every seat over, under or right of it. A steep line crosses both
 * the seat over its point and the one under it, and a computed value has no
 * shifted seat; the elbow the line leaves beside the point still reads as its own.
 */
const BESIDE_PENALTY = 5;

function containedRect(plot: Rect, centerX: number, y: number, width: number, height: number): Rect | null {
  if (width > plot.w || height > plot.h || y < plot.y || y + height > plot.y + plot.h) return null;
  const x = Math.max(plot.x + width / 2, Math.min(centerX, plot.x + plot.w - width / 2));
  return { x: x - width / 2, y, w: width, h: height };
}

/**
 * Where a name can sit on its line: the middle of each drawn stretch between
 * two points, the level run of a step, where no value prints. Where
 * no middle is clear, a quarter of the way along a stretch, and last the
 * points themselves. `tier` orders the three.
 */
function inlineAnchors(series: NormSer, mark: LineMarks['series'][number], interpolation: LineInterpolation, categoryOrder: Map<Id, number>): { categoryId: Id; x: number; y: number; order: number; tier: number }[] {
  const vertices = mark.points.map((point) => ({ ...point, order: categoryOrder.get(point.categoryId) ?? -1, tier: 2 }));
  const stroke = drawnStroke(vertices, interpolation);
  const along = (share: number, tier: number, suffix: string) => vertices.flatMap((point, index) => {
    const next = vertices[index + 1];
    if (!next || (!series.interpolateGaps && next.order !== point.order + 1)) return [];
    const x = point.x + (next.x - point.x) * share;
    return [{ categoryId: `${point.categoryId}->${next.categoryId}${suffix}`, x, y: polylineYAt(stroke, x), order: point.order, tier }];
  });
  return [...along(0.5, 0, ''), ...along(0.25, 1, ':q1'), ...along(0.75, 1, ':q3'), ...vertices];
}

export function placeInlineSeriesLabels(input: {
  enabled: boolean;
  drawnSeries: NormSer[];
  marks: LineMarks;
  interpolationFor: (series: NormSer) => LineInterpolation;
  categoryOrder: Map<Id, number>;
  plot: Rect;
  /** Band dividers the annotation pass draws after the solve; a name keeps 2px off each. */
  dividerXs: readonly number[];
  measure: TextMeasurer;
  labelFont: FontSpec;
  labelH: number;
  labelRequests: LabelRequest[];
  highlights: Set<Id>;
  heroId?: Id | null;
  /** A name stands just over or under its line before it sits on it (the end-name fallback). */
  beside?: boolean;
  /** The bold face of a focus series' name (lineFocusFont). */
  focusFont?: FontSpec;
}): void {
  if (!input.enabled) return;
  const plotCenter = input.plot.x + input.plot.w / 2;
  input.drawnSeries.forEach((series) => {
    const mark = input.marks.series.find((entry) => entry.seriesId === series.id);
    if (!mark || mark.points.length === 0) return;
    const anchors = inlineAnchors(series, mark, input.interpolationFor(series), input.categoryOrder);
    const ordered = [...anchors].sort((a, b) => a.tier - b.tier || Math.abs(a.x - plotCenter) - Math.abs(b.x - plotCenter) || a.order - b.order);
    const text = series.label;
    const nameFont = input.focusFont && input.highlights.has(series.id) ? input.focusFont : input.labelFont;
    const width = input.measure(text, nameFont).width;
    const onLine: SlotCandidate[] = [];
    const beside: SlotCandidate[] = [];
    // a fallback name never sits on a line: text stays in
    // front of every line, and a data line cannot break around it. With no
    // clear seat beside its line, the key row names the lines.
    const clear = (rect: Rect): boolean => !input.marks.series.some((entry) => entry.points.some((point, i) => {
      const next = entry.points[i + 1];
      return next !== undefined && segmentHitsRect(point, next, rect, 1);
    }));
    if (!input.beside) ordered.forEach((point, index) => {
      const rect = containedRect(input.plot, point.x, point.y - input.labelH / 2, width, input.labelH);
      if (rect && !input.dividerXs.some((x) => x > rect.x - 3.5 && x < rect.x + rect.w + 3.5)) onLine.push({ slot: `inline:${point.categoryId}`, rect, penalty: input.beside ? 2 * ordered.length + index : index, needsBacking: true });
    });
    // Where no stretch of the line is clear, as between two close lines with
    // a gap wash, the name sits just over or under its line, as a name on a
    // printed chart does. These seats come after every seat on the line.
    // The fallback names take the side of their line with more room to the next line first.
    const others = input.marks.series.filter((entry) => entry.seriesId !== series.id && entry.points.length > 0);
    const yAt = (points: readonly { x: number; y: number }[], x: number): number | undefined => {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) return b.x === a.x ? a.y : a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x);
      }
      return undefined;
    };
    // The room over or under a seat: to the nearest other line across the name's width, or to the plot edge.
    const roomOf = (rect: Rect, above: boolean, lineY: number): number => {
      const xs = [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
      const ys = others.flatMap((entry) => xs.flatMap((x) => yAt(entry.points, x) ?? []));
      // A steep line of its own that runs through the name gives it no room at all.
      const own = xs.flatMap((x) => yAt(mark.points, x) ?? []);
      if (own.some((y) => above ? y < rect.y + rect.h + 2 : y > rect.y - 2)) return -1;
      const edge = above ? rect.y - input.plot.y : input.plot.y + input.plot.h - rect.y - rect.h;
      return Math.min(edge, minOf(ys.filter((y) => above ? y < lineY : y > lineY).map((y) => above ? rect.y - y : y - rect.y - rect.h)));
    };
    const roomy: { cand: SlotCandidate; room: number; index: number }[] = [];
    ordered.forEach((point, index) => {
      for (const [side, y] of [['over', point.y - input.labelH - 3], ['under', point.y + 3]] as const) {
        const rect = containedRect(input.plot, point.x, y, width, input.labelH);
        if (rect && !input.dividerXs.some((x) => x > rect.x - 3.5 && x < rect.x + rect.w + 3.5) && (!input.beside || clear(rect))) {
          const cand = { slot: `inline:${side}:${point.categoryId}`, rect, penalty: input.beside ? index : ordered.length + index };
          if (input.beside) roomy.push({ cand, room: roomOf(rect, side === 'over', point.y), index: roomy.length });
          else beside.push(cand);
        }
      }
    });
    // The fallback names stand where their line has the most room to its neighbours.
    pushAll(beside, roomy.sort((a, b) => b.room - a.room || a.index - b.index).map(({ cand }, i) => ({ ...cand, penalty: i })));
    const overSeats = beside.length;
    // A steep line leaves no room over or under it: its name stands beside it, level with a point.
    if (input.beside) ordered.forEach((point) => {
      for (const [side, x, y] of [['left', point.x - 4 - width, point.y - input.labelH], ['right', point.x + 4, point.y], ['left', point.x - 4 - width, point.y], ['right', point.x + 4, point.y - input.labelH], ['left', point.x - 6 - width, point.y - input.labelH / 2], ['right', point.x + 6, point.y - input.labelH / 2]] as const) {
        const rect = { x, y, w: width, h: input.labelH };
        if (rect.x < input.plot.x || rect.x + rect.w > input.plot.x + input.plot.w || rect.y < input.plot.y || rect.y + rect.h > input.plot.y + input.plot.h) continue;
        if (input.dividerXs.some((d) => d > rect.x - 3.5 && d < rect.x + rect.w + 3.5) || !clear(rect)) continue;
        if (!beside.some((cand) => cand.rect.x === rect.x && cand.rect.y === rect.y)) beside.push({ slot: `inline:${side}:${point.categoryId}:${beside.length}`, rect, penalty: beside.length });
      }
    });
    // A seat beside a point with
    // less than a line of air to another line wedges the name between the
    // lines; the seats clear of the other lines come first.
    if (input.beside) {
      const airOf = (rect: Rect): number => Math.min(Infinity, minOf(others.flatMap((entry) => [rect.x, rect.x + rect.w / 2, rect.x + rect.w].flatMap((x) => {
        const y = yAt(entry.points, x);
        return y === undefined ? [] : [y < rect.y ? rect.y - y : y > rect.y + rect.h ? y - rect.y - rect.h : 0];
      }))));
      const side = beside.splice(overSeats);
      const airy = side.filter((cand) => airOf(cand.rect) >= input.labelH);
      pushAll(beside, [...airy, ...side.filter((cand) => !airy.includes(cand))].map((cand, i) => ({ ...cand, penalty: overSeats + i })));
    }
    // The solver takes the first free seat in this order.
    const candidates = input.beside ? [...beside, ...onLine] : [...onLine, ...beside];
    input.labelRequests.push({
      id: `series:${series.id}`,
      kind: 'series',
      owner: { seriesId: series.id },
      text,
      lines: [text],
      typeRole: 'label', font: nameFont,
      priority: NAME_PRIORITY + (input.highlights.has(series.id) || input.heroId === series.id ? PRIORITY.highlightBonus : 0),
      candidates,
    });
  });
}

function endpointAnchor(label: EndLabel, marks: LineMarks, cats: Category[], isStacked: boolean, y: (value: number) => number, cumTop: number[][], cumBot: number[][]): Point | null {
  const point = marks.series.find((item) => item.seriesId === label.s.id)?.points.find((item) => item.categoryId === cats[label.ci]!.id);
  if (!point) return null;
  return isStacked ? { x: point.x, y: (y(cumTop[label.dataIdx]![label.ci]!) + y(cumBot[label.dataIdx]![label.ci]!)) / 2 } : point;
}

function endpointCandidate(input: { slot: string; rect: Rect; penalty: number; size: { width: number; height: number }; outsideRankBand: (rect: Rect) => boolean; leaderFrom?: Point; leaderClearsAreaFill: boolean; isArea: boolean; isStacked: boolean; keepLeader?: boolean; desiredY: number }): SlotCandidate | null {
  const { rect, size, leaderFrom } = input;
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > size.width || rect.y + rect.h > size.height || input.outsideRankBand(rect)) return null;
  return {
    slot: input.slot,
    rect,
    penalty: input.penalty,
    ...(leaderFrom && input.leaderClearsAreaFill && (input.isArea || input.isStacked || input.keepLeader || Math.abs(rect.y + rect.h / 2 - input.desiredY) > ENDPOINT_LEADER_MIN_DY) ? { leaderFrom } : {}),
  };
}

/**
 * the height each name claims in the spread. Rank rows are closer
 * than a name plus its 4 px of air (18 px rows for 16 px names), so names
 * claimed more than a row each, drifted off their rows and needed bent
 * leaders over the rank numbers. On a rank ladder where every name fits its
 * row with 2 px to spare and no two names share a row (no tie), each claims
 * exactly one row, so all stand on their rows. Else, and off a ladder, each
 * keeps its 2 px of air; its leader then goes through the solver
 * (`leaderClear`).
 */
export function nameSpreadSizes(heights: readonly number[], rankYs?: readonly (number | undefined)[]): number[] {
  const loose = heights.map((h) => h + 2);
  if (!rankYs) return loose;
  const ys = rankYs.filter((y): y is number => y !== undefined);
  const rows = [...new Set(ys)].sort((a, b) => a - b);
  if (rows.length < ys.length || rows.length < 2) return loose;
  const pitch = minOf(rows.slice(1).map((y, i) => y - rows[i]!));
  // Names two or more rows apart (a focused ladder) keep their own claim: the pitch is a ceiling, never a size.
  return heights.every((h) => h + 2 <= pitch) ? heights.map((h) => Math.min(h + 2, pitch - 2)) : loose;
}

export function placeEndpointLabels(input: {
  endLabels: EndLabel[];
  /** Left edge of the name column. */
  columnX: number;
  endSwatchReserve: number;
  endpointSwatches: boolean;
  marks: LineMarks;
  paintedAreaCats: Map<Id, Set<number>>;
  cats: Category[];
  plot: Rect;
  size: { width: number; height: number };
  isStacked: boolean;
  isArea: boolean;
  y: (value: number) => number;
  cumTop: number[][];
  cumBot: number[][];
  outsideRankBand: (rect: Rect) => boolean;
  warnings: LintWarning[];
  labelRequests: LabelRequest[];
  labelFont: FontSpec;
  highlights: Set<Id>;
  keyPaint: (series: NormSer, dataIdx: number) => Paint;
  seriesPaint: (series: NormSer, dataIdx: number) => Paint;
  /**
   * `endLabelPlacement: 'lineEnd'`: a series whose last
   * drawn point lies before the last category is labelled beside that point.
   * The gutter slots follow as the fallback, and only the labels that end at
   * the last category are spread in the gutter.
   */
  atLineEnd?: boolean;
  /**
   * The last values print. Where two or more lines end within a
   * line of each other at the last category, each name takes its value.
   * A pair uses one joined line; larger sets first try a second line. Its
   * leader joins both to the endpoint. The ids of those series go into
   * `merged`, and the point pass prints no second copy.
   */
  valuesAtEnd?: { merged: Set<Id>; measure: TextMeasurer };
  /** Crowded ends take the line colour ahead of the name (not on a rank ladder). */
  crowdedEnds?: boolean;
  /** A rank ladder: names stand on their rank rows (nameSpreadSize). */
  rankLadder?: boolean;
  /** Keep the name within three label line heights of its endpoint. */
  bounded?: { lineHeight: number; fallback: boolean; wide: boolean; widen: boolean };
  /**
   * On a plain line every name at the last
   * category takes its last value on one line ("Cloud ARR 189"), not only a
   * crowded pair; the point pass prints no second copy.
   */
  joinEvery?: boolean;
}): Map<Id, Point> {
  const leaders = new Map<Id, Point>();
  if (input.endLabels.length === 0) return leaders;
  const anchors = input.endLabels.map((label) => endpointAnchor(label, input.marks, input.cats, input.isStacked, input.y, input.cumTop, input.cumBot));
  const swatched = new Set<Id>();
  // A converging pair always reads on one line each; larger clusters join only when they do not fit.
  const pairs = new Set<Id>();
  if (input.crowdedEnds && !input.isStacked && !input.isArea) {
    const atLast = input.endLabels.flatMap((label, index) => (label.ci === input.cats.length - 1 && !label.shared && anchors[index] ? [index] : []))
      .sort((a, b) => anchors[a]!.y - anchors[b]!.y);
    const clusters: number[][] = [];
    for (const index of atLast) {
      const cluster = clusters[clusters.length - 1];
      if (cluster && anchors[index]!.y - anchors[cluster[cluster.length - 1]!]!.y < input.endLabels[index]!.h + 5) cluster.push(index);
      else clusters.push([index]);
    }
    const joinEvery = input.joinEvery === true && input.bounded !== undefined;
    for (const cluster of clusters.filter((members) => joinEvery || members.length >= (input.bounded ? 2 : 3))) {
      const fits: Id[] = [];
      for (const index of cluster) {
        const label = input.endLabels[index]!;
        let w = label.w;
        if (input.valuesAtEnd && label.valueText) {
          const valueText = label.valueText;
          const lineH = label.h / Math.max(1, label.lines.length);
          // shortcut: the column reserve was sized from the names; a value wider than its name overhangs it by the difference.
          w = Math.max(label.w, input.valuesAtEnd.measure(valueText, input.labelFont).width);
          input.endLabels[index] = { ...label, text: `${label.text} ${valueText}`, lines: [...label.lines, valueText], h: label.h + lineH, w };
          input.valuesAtEnd.merged.add(label.s.id);
          if (cluster.length === 2 || joinEvery) pairs.add(label.s.id);
        }
        // Leaders from one crowded point fan too steeply to follow: the line's
        // colour ahead of the name tells them apart, where the canvas has room
        // for every name of the group; a group half swatched says less.
        if (!input.bounded && !input.endpointSwatches && input.endSwatchReserve === 0 && input.columnX + w + SWATCH_RESERVE <= input.size.width) fits.push(label.id);
      }
      if (fits.length === cluster.length) for (const id of fits) swatched.add(id);
    }
  }
  // A line that ends before the last category: its name in the gutter stands
  // level with another line's end, so it always keeps its leader.
  const endsEarly = input.endLabels.map((label, index) => !input.isArea && anchors[index] !== null && label.ci < input.cats.length - 1);
  const early = endsEarly.map((ends) => ends && input.atLineEnd === true);
  const sizes = nameSpreadSizes(input.endLabels.map((label) => label.h), input.rankLadder ? anchors.map((anchor) => anchor?.y) : undefined);
  let items = anchors.map((anchor, index) => ({ desired: anchor?.y ?? input.plot.y + input.plot.h / 2, size: sizes[index]! }));
  const edgeIndices = items.flatMap((_, index) => (early[index] ? [] : [index]));
  let edgeItems = edgeIndices.map((index) => items[index]!);
  // A column inside the plot keeps clear of the baseline's claim and the 2px pad.
  const range: [number, number] = [input.plot.y, input.plot.y + input.plot.h - (input.columnX < input.plot.x + input.plot.w ? 3 : 0)];
  let spread = spread1DResult(edgeItems, range, 2);
  if (input.bounded) {
    const bound = input.bounded.lineHeight * END_LABEL_MAX_DISPLACEMENT_LINES;
    const fits = () => spread.fits && edgeIndices.every((index, k) => Math.abs(spread.positions[k]! - items[index]!.desired) <= bound);
    const joinAll = !fits();
    if (input.valuesAtEnd && (joinAll || pairs.size > 0)) {
      // A joined row costs one line height and keeps each rounded value legible.
      for (const index of edgeIndices) {
        const label = input.endLabels[index]!;
        if (!input.valuesAtEnd.merged.has(label.s.id) || !label.valueText || !joinAll && !pairs.has(label.s.id)) continue;
        const name = label.lines.slice(0, -1).join(' ');
        const text = `${name} ${label.valueText}`;
        input.endLabels[index] = { ...label, text, lines: [text], h: input.bounded.lineHeight,
          w: input.valuesAtEnd.measure(`${name} `, input.labelFont).width + input.valuesAtEnd.measure(label.valueText, input.labelFont).width };
      }
      items = anchors.map((anchor, index) => ({ desired: anchor?.y ?? input.plot.y + input.plot.h / 2, size: input.endLabels[index]!.h + 2 }));
      edgeItems = edgeIndices.map(index => items[index]!);
      spread = spread1DResult(edgeItems, range, 2);
    }
    const tooWide = edgeIndices.some(index => input.columnX + input.endLabels[index]!.w + input.endSwatchReserve > input.size.width - 8);
    if (fits() && tooWide && !input.bounded.wide && input.valuesAtEnd?.merged.size) {
      input.bounded.widen = true;
      return leaders;
    }
    if (!fits() || tooWide) {
      input.bounded.fallback = true;
      return leaders;
    }
  }
  warnSpreadOverflow(input.warnings, spread.fits, 'endpoint labels exceed the plot height even after spreading — labels stay bounded but overlap; fewer series or a larger canvas fixes it');
  const edgePositions = spread.fits ? spread.positions : spread1D(edgeItems, range, 2);
  const positions = items.map((item) => item.desired);
  edgeIndices.forEach((index, k) => { positions[index] = edgePositions[k]!; });
  input.endLabels.forEach((label, index) => {
    const anchor = anchors[index];
    const desiredY = anchor?.y ?? input.plot.y + input.plot.h / 2;
    const rect = { x: input.columnX, y: positions[index]! - label.h / 2, w: label.w + (swatched.has(label.id) ? SWATCH_RESERVE : input.endSwatchReserve), h: label.h };
    const leaderFrom = anchor ? { x: Math.min(anchor.x + ENDPOINT_LEADER_CLEARANCE, rect.x - 2), y: anchor.y } : undefined;
    if (leaderFrom) leaders.set(label.id, leaderFrom);
    const common = { size: input.size, outsideRankBand: input.outsideRankBand, leaderFrom, leaderClearsAreaFill: !input.isArea || !input.paintedAreaCats.has(label.s.id) || label.ci === input.cats.length - 1 && input.paintedAreaCats.get(label.s.id)?.has(label.ci) === true, isArea: input.isArea, isStacked: input.isStacked, keepLeader: endsEarly[index]!, desiredY };
    // Beside the series' own last point: right of it, then above and below
    // it to the right. The ring of a latest point is 4.5px, so the text
    // starts 8px past the point. Last, one row higher: the value takes the
    // seat above the point first, and the name reads over it.
    const atPoint = early[index] && anchor
      ? [
        { slot: 'besideEnd', rect: { ...rect, x: anchor.x + 8, y: anchor.y - label.h / 2 }, penalty: 0 },
        { slot: 'aboveEnd', rect: { ...rect, x: anchor.x + 4, y: anchor.y - label.h - 6 }, penalty: 1 },
        { slot: 'belowEnd', rect: { ...rect, x: anchor.x + 4, y: anchor.y + 6 }, penalty: 1 },
        { slot: 'overValueEnd', rect: { ...rect, x: anchor.x + 4, y: anchor.y - 2 * label.h - 8 }, penalty: 2 },
        // Left of the point, where the lines that run on leave the right side
        // no room: a line that ends at its first category.
        { slot: 'beforeEnd', rect: { ...rect, x: anchor.x - 8 - rect.w, y: anchor.y - label.h / 2 }, penalty: 2.5 },
        { slot: 'belowBeforeEnd', rect: { ...rect, x: anchor.x - 4 - rect.w, y: anchor.y + 6 }, penalty: 2.5 },
        // A row further from the point, where other lines crowd the near rows
        // and the value took the row above: over the value, as "Jun 26" reads
        // over "60%", or under the rows below. Only then the right-hand rail,
        // whose leader would cross the plot ("Mar 26" beside "Sep 25").
        ...[1, 2].flatMap((k) => [
          { slot: `overValueEnd${k}`, rect: { ...rect, x: anchor.x - rect.w / 2, y: anchor.y - (2 + k) * (label.h + 2) - 8 }, penalty: 2.6 + k / 10 },
          { slot: `belowEnd${k}`, rect: { ...rect, x: anchor.x + 4, y: anchor.y + 6 + k * (label.h + 2) }, penalty: 2.6 + k / 10 },
        ]),
      ].map((candidate) => endpointCandidate({ ...candidate, ...common, leaderFrom: undefined }))
      : [];
    const candidates = [
      ...atPoint,
      endpointCandidate({ slot: 'lineEnd', rect, penalty: atPoint.length > 0 ? 3 : 0, ...common }),
      ...(!input.bounded || early[index] ? [endpointCandidate({ slot: 'lineEndShifted', rect: { ...rect, y: rect.y + label.h + 2 }, penalty: atPoint.length > 0 ? 4 : 1, ...common })] : []),
    ].filter((item): item is SlotCandidate => item !== null && (!input.bounded || Math.abs(item.rect.y + item.rect.h / 2 - desiredY) <= input.bounded.lineHeight * END_LABEL_MAX_DISPLACEMENT_LINES));
    input.labelRequests.push({
      id: label.id,
      kind: label.kind,
      owner: { seriesId: label.s.id, categoryId: input.cats[label.ci]!.id },
      text: label.text,
      lines: label.lines,
      ...(label.valueText && label.text.endsWith(` ${label.valueText}`)
        ? { printsFor: [{ seriesId: label.s.id, categoryId: input.cats[label.ci]!.id }] } : {}),
      ...(label.title !== undefined ? { title: label.title } : {}),
      typeRole: 'label', font: label.font ?? input.labelFont, ...(label.font ? { fontStep: label.font } : {}),
      // A name at an early end shares its point with the last value, and the
      // value places first so it sits at the point (cohort curves).
      priority: (early[index] ? PRIORITY.endpoint - 1 : NAME_PRIORITY) + (input.highlights.has(label.s.id) ? PRIORITY.highlightBonus : 0),
      candidates,
      ...(input.bounded ? { leaderClear: 'includingPins' as const } : {}),
      // A name at an early end takes a seat only where it lies nearer its
      // own end than another series' marks; the rows further out (over the
      // value, under the rows below) can reach a crossing line.
      ...(early[index] && anchor ? { anchor: { x: anchor.x, y: anchor.y } } : {}),
      // A shared label names several series; one colour swatch would claim it belongs to one of them.
      ...(label.shared ? {} : input.isArea ? { swatch: input.keyPaint(label.s, label.dataIdx) } : input.endpointSwatches || swatched.has(label.id) ? { swatch: input.seriesPaint(label.s, label.dataIdx) } : {}),
    });
  });
  return leaders;
}

interface PointLabelSeed {
  ci: number;
  text: string;
  w: number;
  priority: number;
  suppressed: boolean;
}

interface PointLabelCandidate extends PointLabelSeed {
  x: number;
  py: number;
  insideFill?: string;
  insidePaint?: Paint;
  bandTop?: number;
  bandBot?: number;
}

interface PointLabelInput {
  series: NormSer;
  row: (number | null)[];
  cats: Category[];
  variant: LineVariant;
  rebased: boolean;
  content: LabelContent;
  composeText: ComposeText;
  composeEndText?: ComposeText;
  absOf: (series: NormSer, categoryIndex: number) => number | null;
  measure: TextMeasurer;
  labelFont: FontSpec;
  highlights: Set<Id>;
  categoryIndices?: number[];
  sharesWithheld: ReadonlySet<Id>;
  /** The unit the last value of a series carries when nothing else prints it. */
  endUnitSuffix: string;
  /** Every value carries that unit, not only the last (a rank ladder). */
  unitOnEvery?: boolean;
}

function pointLabelSeeds(input: PointLabelInput): PointLabelSeed[] {
  const { series, row, cats } = input;
  const drawn = row.flatMap((value, ci) => (value === null ? [] : [ci]));
  const values = drawn.map((ci) => row[ci]!);
  const min = minOf(values);
  const max = maxOf(values);
  const last = drawn[drawn.length - 1];
  const seeds: PointLabelSeed[] = [];
  for (const ci of input.categoryIndices ?? drawn) {
    const category = cats[ci]!;
    const value = row[ci]!;
    if (value === null) continue;
    const cell = series.vals[ci]!;
    const source = input.rebased ? undefined : cell.format ? { ...series, format: cell.format } : series;
    const pct = input.variant === 'stacked100-area' && !input.sharesWithheld.has(category.id) ? value : null;
    const abs = input.rebased ? value : input.absOf(series, ci);
    // The last value carries the unit nothing else on the page prints.
    const unitSuffix = input.unitOnEvery || ci === last ? input.endUnitSuffix : '';
    const composeText = ci === last ? input.composeEndText ?? input.composeText : input.composeText;
    let text = composeText(input.content, abs, pct, category.label ?? category.id, series.label, unitSuffix, cell.isPct, source, category.id);
    if (typeof cell.labelOverride === 'string') {
      text = authoredCellText(cell.labelOverride, {
        composeText, variant: input.variant, abs, pct,
        isPct: cell.isPct, unitSuffix, source, categoryId: category.id,
      });
    }
    if (!text && cell.labelOverride !== false) continue;
    const endpoint = ci === drawn[0] || ci === last;
    const extreme = value === min || value === max;
    const highlighted = input.highlights.has(series.id) || input.highlights.has(category.id);
    const priority = cell.priority ?? (endpoint ? PRIORITY.endpoint : extreme ? PRIORITY.extreme : PRIORITY.interior + Math.min(99, Math.abs(value))) + (highlighted ? PRIORITY.highlightBonus : 0);
    seeds.push({ ci, text, w: input.measure(text || '0', input.labelFont).width, priority, suppressed: cell.labelOverride === false });
  }
  return seeds;
}

function buildPointCandidates(input: PointLabelInput & {
  dataIdx: number;
  isStacked: boolean;
  y: (value: number) => number;
  cumTop: number[][];
  cumBot: number[][];
  xOf: (categoryIndex: number) => number;
  plot: Rect;
  paintedAreaCats: Map<Id, Set<number>>;
  areaFillPaint: (series: NormSer, dataIdx: number) => Paint;
  paintCss: (paint: Paint) => string;
  /** The points to label, chosen by the caller. */
  categoryIndices: number[];
}): PointLabelCandidate[] {
  const { series, dataIdx, row } = input;
  return pointLabelSeeds(input).map((seed) => {
    const { ci, w: width } = seed;
    const value = row[ci]!;
    const py = input.isStacked ? input.y(input.cumTop[dataIdx]![ci]!) : input.y(value!);
    const center = width <= input.plot.w ? Math.max(input.plot.x + width / 2, Math.min(input.xOf(ci), input.plot.x + input.plot.w - width / 2)) : input.xOf(ci);
    const candidate: PointLabelCandidate = { ...seed, x: center, py };
    if (input.isStacked) {
      candidate.bandTop = input.y(input.cumTop[dataIdx]![ci]!);
      candidate.bandBot = input.y(input.cumBot[dataIdx]![ci]!);
      if (input.paintedAreaCats.get(series.id)?.has(ci)) {
        candidate.insidePaint = input.areaFillPaint(series, dataIdx);
        candidate.insideFill = input.paintCss(candidate.insidePaint);
      }
    }
    return candidate;
  });
}

/**
 * The value box inside its band. The centred box stays when
 * neither edge comes within 2px of it. Otherwise the box takes the middle of
 * the window the band keeps open across the box's span: under the lowest
 * point of the top edge and over the highest point of the bottom edge there.
 * Undefined when that window is shorter than the box and 4px of air.
 */
function insideBandEdges(rect: Rect, edges: { top: readonly Point[]; bottom: readonly Point[] }, labelH: number): Rect | undefined {
  const hits = (edge: readonly Point[]) => edge.some((point, i) => i > 0 && segmentHitsRect(edge[i - 1]!, point, rect, 2));
  if (!hits(edges.top) && !hits(edges.bottom)) return rect;
  const x0 = rect.x;
  const x1 = rect.x + rect.w;
  const within = (edge: readonly Point[]) => [polylineYAt(edge, x0), polylineYAt(edge, x1), ...edge.filter((p) => p.x > x0 && p.x < x1).map((p) => p.y)];
  const top = maxOf(within(edges.top));
  const bottom = minOf(within(edges.bottom));
  if (bottom - top < labelH + 4) return undefined;
  return { ...rect, y: (top + bottom) / 2 - labelH / 2 };
}

/**
 * The category indices of each drawn run of a row: one run over every
 * value when the line bridges its gaps, split at each null when it does
 * not (`interpolateGaps: false`), so no phantom segment spans a gap.
 */
function drawnRuns(row: readonly (number | null)[], interpolateGaps: boolean): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  row.forEach((value, ci) => {
    if (value !== null) run.push(ci);
    else if (!interpolateGaps && run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

/** The to-date words and where they print. */
export interface ToDateWords { ids: ReadonlySet<Id>; words: string; theme: Theme; measure: TextMeasurer }

/**
 * The running categories whose values print the to-date words under them
 * ("3.5" over "to date"), as on combo: the value labels of a single plain
 * (not stacked, not rank) line. The axis name and the note then carry no words.
 * The layout checks after the solve that every drawn value there prints
 * them, and otherwise runs again with the words on the axis name.
 */
export function lineToDateIds(env: LineEnv, domain: LineDomain, text: Pick<LineText, 'contentOf'>): Set<Id> {
  const ids = new Set<Id>();
  const { options, cats } = domain;
  // Only a single line has one running value per period; among several lines (a prior year among
  // them) the axis words name the period for all, as combo marks its one running total only.
  if (partialKeyForced(options) || !cats.some((c) => c.partial === true) || domain.drawnSeries.length !== 1 || env.isBump || domain.isStacked || domain.fan
    || domain.labelModes.values === 'none' || text.contentOf('point', ['absolute']) === null) return ids;
  const words = options.strings?.toDate ?? chartString(options, 'toDate');
  // A time axis has no category step to bound the words; its end value keeps room for them (pointLabelEndRoom).
  if (!domain.x && !toDateFits(words, env.theme, env.measure, env.size.width / Math.max(1, cats.length))) return ids;
  cats.forEach((c, ci) => {
    if (c.partial === true && !saysToDate(c.label ?? c.id, words) && domain.drawnSeries.some((s) => (s.vals[ci]?.v ?? null) !== null)) ids.add(c.id);
  });
  return ids;
}

function pushPointRequests(input: {
  continued?: boolean;
  candidates: PointLabelCandidate[];
  series: NormSer;
  cats: Category[];
  isStacked: boolean;
  variant: LineVariant;
  labelH: number;
  step: number;
  density: NonNullable<LineOptions['labelDensity']>;
  plot: Rect;
  labelFont: FontSpec;
  labelRequests: LabelRequest[];
  /** The series' own drawn runs; a value never sits on them. */
  ownQueries: readonly PolylineQueries[];
  /** Every other drawn series' runs; a value is never nearer one of them than its own. */
  others: readonly (readonly Point[])[];
  otherQueries: readonly PolylineQueries[];
  xOf: (categoryIndex: number) => number;
  /** The last value may also sit right of its point: no end name stands there. */
  besideLast: boolean;
  /** A stacked series' band edges as drawn, top and bottom. */
  bandEdges?: { top: readonly Point[]; bottom: readonly Point[] };
  bump?: { headroom: number; named?: ReadonlySet<string> };
  /** The series' plotted row, to find a category with no drawn neighbour. */
  row?: readonly (number | null)[];
  /** The categories a stacked series' band fill covers, to find where a band run starts and ends. */
  painted?: ReadonlySet<number>;
  /** "Series in category" of each value dropped here, for the chart's one warning each. */
  lost: { sliver: string[]; thinned: string[] };
  regularRow?: boolean;
  /** A focus value can sit left of its first point, clear of a steep rising line. */
  highlighted?: boolean;
  /** The top band of a stack: an authored value too thin for it sits in the air over it. */
  topBand?: boolean;
  /** The baseline y of the lead fill of an area that also draws lines: its values keep off that fill, where the lines' values would not tell them apart. */
  fillTo?: number;
  /** A selected end value reads with its series name, including a shared name. */
  namedEnd?: boolean;
  /** A Rest series of a stack: its values are hidden and named in the note line. */
  restHidden?: boolean;
  /** The running categories whose values print the to-date words under them (lineToDateIds). */
  toDate?: ToDateWords;
}): void {
  // An authored `label: false` draws nothing, so it holds no room from a neighbour (a hidden
  // running week must not take the authored value of the last complete week with it).
  // The solver must try the whole row before it retries the alternate subset.
  const keep = input.regularRow ? input.candidates.map(candidate => !candidate.suppressed)
    : sweepHide(input.candidates.map((candidate) => ({ start: candidate.x - candidate.w / 2, size: candidate.w, priority: candidate.suppressed ? -Infinity : candidate.priority })), 4);
  const lastDrawn = input.series.vals.reduce((last, cell, ci) => (cell.v === null ? last : ci), -1);
  const firstDrawn = input.series.vals.findIndex((cell) => cell.v !== null);
  const { ownQueries, otherQueries } = input;
  input.candidates.forEach((candidate, index) => {
    const category = input.cats[candidate.ci]!;
    const name = `${input.series.label} in ${category.label ?? category.id}`;
    // A running category's value says so under it, in the secondary step and the muted ink.
    const words = !input.isStacked && input.toDate?.ids.has(category.id) ? toDateLabel(candidate.text, input.labelFont, input.toDate.words, input.toDate.theme, input.toDate.measure) : undefined;
    const labelH = words?.size.height ?? input.labelH;
    const w = words?.size.width ?? candidate.w;
    const redundant = candidate.suppressed || !keep[index];
    // An authored label string keeps every seat a computed value gives up.
    const authored = typeof input.series.vals[candidate.ci]?.labelOverride === 'string';
    const namedEnd = input.namedEnd && candidate.ci === lastDrawn;
    const computed = !namedEnd && !authored;
    const continuedEnd = input.continued && (candidate.ci === firstDrawn || candidate.ci === lastDrawn);
    // A seat beside the point centres 4px + half the value off it: nearer the
    // neighbour's point where the step is narrower than the value plus 8px.
    const beside = computed && input.step > w + 8;
    // A value thinned out or too big for its band is lost, not printed
    // elsewhere: the note line names it. An authored `label: false` is no loss.
    const lost = candidate.suppressed ? {} : { suppressedAs: 'density' as const };
    // A Rest series prints no value by default on the dashboard target (labels.restSeries); the note line owes it.
    const rest = input.restHidden === true && !candidate.suppressed;
    const restFields = rest ? restValueHiding(`${input.series.label} ${candidate.text} (${noteName(category)})`) : {};
    let slots: SlotCandidate[];
    if (input.isStacked) {
      const bandH = candidate.bandBot! - candidate.bandTop!;
      // One measured fit for every stacked variant. The band edges over the
      // box's span (insideBandEdges) decide the rest; a doubled height for
      // stacked100-area would send a band that holds its value above the plot.
      const fits = input.labelH + 2 <= bandH && candidate.w + 4 <= input.step;
      // The value lies wholly on its band: at the first and last category
      // the box moves inward along the band, 5px off the band's end (its chip
      // clears the band's dashed forecast edge), where
      // centred on the point it would hang half off the fill. A stacked band
      // never steps (the domain draws a requested step linearly), so the
      // stretch it moves into belongs to its own category; a stepped end has
      // no width of its own, and would need a leader instead.
      const ends = input.bandEdges ? [input.bandEdges.top[0]!.x + 5, input.bandEdges.top[input.bandEdges.top.length - 1]!.x - 5] : [input.plot.x, input.plot.x + input.plot.w];
      // A band also starts or ends next to a category it does not fill (n.m., n/a):
      // the box moves inward there too, so it never hangs half on the page.
      const painted = input.painted;
      if (painted?.has(candidate.ci)) {
        if (candidate.ci > 0 && !painted.has(candidate.ci - 1)) ends[0] = Math.max(ends[0]!, input.xOf(candidate.ci) + 5);
        if (candidate.ci < input.cats.length - 1 && !painted.has(candidate.ci + 1)) ends[1] = Math.min(ends[1]!, input.xOf(candidate.ci) - 5);
      }
      // A category with no drawn neighbour stands as a short column
      // centred on its point (marks.ts), so its value centres there too.
      const lone = input.row !== undefined && (input.row[candidate.ci - 1] ?? null) === null && (input.row[candidate.ci + 1] ?? null) === null;
      const x = lone ? candidate.x : Math.max(ends[0]! + candidate.w / 2, Math.min(candidate.x, ends[1]! - candidate.w / 2));
      const centred = containedRect(input.plot, x, (candidate.bandTop! + candidate.bandBot!) / 2 - input.labelH / 2, candidate.w, input.labelH);
      // a value inside its band keeps off the band's own edges. A
      // box a steep edge crosses moves into the widest window the band keeps
      // open over the box's span; a band that keeps none drops the value as
      // one that does not fit.
      const rect = centred && input.bandEdges ? insideBandEdges(centred, input.bandEdges, input.labelH) : centred;
      slots = rect ? [{ slot: rect === centred ? 'insideBand' : 'insideBandFitted', rect, penalty: 0, insideFill: candidate.insideFill, insidePaint: candidate.insidePaint }] : [];
      // The top band has free air above it, so an authored value too thin
      // for its band sits over the band's edge with a leader into it.
      const aboveTop = input.topBand && authored
        // Right of the point, or where a forecast divider moved the value, on its actual side.
        ? containedRect({ ...input.plot, y: input.plot.y - input.labelH - 8, h: input.plot.h + input.labelH + 8 },
          candidate.x !== input.xOf(candidate.ci) ? candidate.x : input.xOf(candidate.ci) + 8 + candidate.w / 2, candidate.bandTop! - input.labelH - 6, candidate.w, input.labelH)
        : null;
      if (aboveTop) {
        const leaderFrom = { x: input.xOf(candidate.ci), y: (candidate.bandTop! + candidate.bandBot!) / 2 };
        if (!fits || (centred && !rect) || (input.density !== 'full' && bandH < SLIVER_MIN_H)) slots = [{ slot: 'aboveBand', rect: aboveTop, penalty: 0, leaderFrom }];
        else if (rect) slots.push({ slot: 'aboveBand', rect: aboveTop, penalty: 1, leaderFrom });
      }
      if (!aboveTop && (!fits || (centred && !rect) || (input.density !== 'full' && bandH < SLIVER_MIN_H))) {
        if (!candidate.suppressed && !rest) input.lost.sliver.push(name);
        input.labelRequests.push({ id: `point:${input.series.id}:${category.id}`, kind: 'point', role: composedTextRole(candidate.text), owner: { seriesId: input.series.id, categoryId: category.id }, text: candidate.text, lines: [candidate.text], typeRole: 'label', font: input.labelFont, priority: candidate.priority, redundant: true, ...lost, ...restFields, candidates: slots,
          // sliver-labels-hidden reports it; the requested-row warn leaves it out.
          quietWhenCrowded: true });
        return;
      }
    } else {
      // Where other lines pass, a value sits nearest its own point,
      // first on the side away from them, and never nearer another series'
      // line than its own. A line alone keeps the plain cascade:
      // above, higher above, then below, where an area or phase fill lies.
      // A rank chart puts every value over its own point, so a value between
      // two rank lines always belongs to the line under it; a side away from
      // the other lines would flip from point to point and leave the top
      // rank no seat at all.
      const away = input.bump ? 'above' : sideAwayFrom({ x: input.xOf(candidate.ci), y: candidate.py }, input.others);
      const order = away === 'below' ? ['below', 'above', 'belowShifted', 'aboveShifted']
        : away === 'above' ? ['above', 'below', 'aboveShifted', 'belowShifted']
          : ['above', 'aboveShifted', 'below', 'belowShifted'];
      const px = input.xOf(candidate.ci);
      // A line through the point itself holds the same value there: the value
      // reads true for it too, so it rivals no seat (cohort curves meet).
      const at = { x: px, y: candidate.py, w: 0, h: 0 };
      // Only a line through the same point is the same value (numeric tolerance).
      // At 1.5 px a neighbour one unit off (83 against 84 on a short plot) lost its rival seat check.
      const rivals = otherQueries.filter(stroke => stroke.distance(at) > 1e-6);
      // Two last seats for a last value that finds none over or under its
      // point, where a fan's wash or the plot top leaves none: right of the
      // point, level with it, where no end name stands there, then over it
      // past the plot top. The canvas and the frame bound them, not the plot.
      const last = candidate.ci === lastDrawn;
      const lateFirst = candidate.ci === firstDrawn && firstDrawn > 0 && !input.bump;
      const rescue = [
        // The first focus value has the same level seat as the last value,
        // mirrored left. A steep rise can block every seat over the point.
        ...(candidate.ci === firstDrawn && input.highlighted ? [
          { slot: 'left', rect: { x: px - w - 7, y: candidate.py - labelH / 2, w, h: labelH }, penalty: 4 },
        ] : []),
        // Use the plot's 8 px axis gutter, with 2 px left clear, when clamping
        // a first endpoint inward would put it on the rising stroke.
        ...(candidate.ci === firstDrawn && !input.bump ? [
          { slot: 'aboveEdge', rect: { x: Math.max(px - w / 2, input.plot.x - 6), y: candidate.py - labelH - 5, w, h: labelH }, penalty: 3 },
        ] : []),
        // Where an area's edge climbs into that seat, the value lifts 4 px, as its raised seat does.
        ...(candidate.ci === firstDrawn && input.variant === 'area' ? [
          { slot: 'aboveEdgeHigh', rect: { x: Math.max(px - w / 2, input.plot.x - 6), y: candidate.py - labelH - 9, w, h: labelH }, penalty: 3.05 },
        ] : []),
        // A gap divider can cross the inward-clamped last forecast value.
        // The reserved canvas margin can hold that value over its own point.
        ...(last && input.variant === 'area' && candidate.ci > 0 && input.series.vals.findIndex(cell => cell.scenario === 'FC') === candidate.ci ? [
          { slot: 'forecastAboveEdge', rect: { x: px - w / 2, y: candidate.py - labelH - 5, w: w, h: labelH }, penalty: 4.2 },
          { slot: 'forecastBelowEdge', rect: { x: px - w / 2, y: candidate.py + 5, w: w, h: labelH }, penalty: 4.3 },
        ] : []),
        ...(last && input.besideLast ? [{ slot: 'right', rect: { x: px + 7, y: candidate.py - labelH / 2, w: w, h: labelH }, penalty: 4 }] : []),
        // Two lines that end a line apart share the seat right of their
        // points; the second value steps half a line off it on a short leader.
        ...(last && input.besideLast ? [1, -1, 2, -2].map((step) => ({
          slot: `rightStep${step}`, rect: { x: px + 9, y: candidate.py - labelH / 2 + step * (labelH + 2), w: w, h: labelH },
          penalty: 4.5 + Math.abs(step) / 10, leaderFrom: { x: px, y: candidate.py },
        })) : []),
        ...(last && candidate.py - labelH - 5 < input.plot.y ? [{ slot: 'aboveOut', rect: { x: candidate.x - w / 2, y: candidate.py - labelH - 5, w: w, h: labelH }, penalty: order.indexOf('above') }] : []),
      ];
      // A last value before the last category may also start at its point,
      // over or under it to the right, where the lines that run on to the
      // left leave room: among cohort curves that keeps it at its point
      // rather than two rows up.
      const early = last && candidate.ci < input.cats.length - 1;
      const x = candidate.x;
      // Rank 1 sits half a rank under the plot top; its value may take the
      // band over the plot, which the frame's text keeps clear of.
      const bounds = input.bump ? { ...input.plot, y: input.plot.y - input.bump.headroom, h: input.plot.h + input.bump.headroom } : input.plot;
      const seats: { slot: string; x: number; y: number; penalty?: number }[] = [
        { slot: 'above', x, y: candidate.py - labelH - 5 },
        { slot: 'below', x, y: candidate.py + 5 },
        { slot: 'aboveShifted', x, y: candidate.py - 2 * labelH - 9 },
        { slot: 'belowShifted', x, y: candidate.py + labelH + 9 },
        // An area's value reads over its edge, never on the fill
        // under it; where the edge climbs into the seat over the point, the value lifts 4 px.
        ...(input.variant === 'area' ? [{ slot: 'aboveRaised', x, y: candidate.py - labelH - 9, penalty: 0.5 }] : []),
        // A rank line that climbs or drops at the point crosses the seat over
        // it: the value keeps over its point, beside the diagonal, before it
        // gives the side up.
        ...(input.bump ? [
          { slot: 'aboveLeft', x: px - 1 - w / 2, y: candidate.py - labelH - 5, penalty: 0.4 },
          { slot: 'aboveRight', x: px + 1 + w / 2, y: candidate.py - labelH - 5, penalty: 0.5 },
        ] : [
          // The seats an early end name takes (placeEndpointLabels), which the
          // value takes first; the name then reads over it. A last value at the
          // last category keeps the seats right of its point above.
          ...(early || (beside && !last) ? [
            { slot: 'aboveRight', x: px + 4 + w / 2, y: candidate.py - labelH - 6, penalty: early ? 1.5 : BESIDE_PENALTY },
            { slot: 'belowRight', x: px + 4 + w / 2, y: candidate.py + 6, penalty: early ? 1.5 : BESIDE_PENALTY },
          ] : []),
          // a late first value mirrors the early last one. It may also end at its
          // point, over or under it to the left, where its own line has not started yet.
          ...(lateFirst || beside ? [
            { slot: 'aboveLeft', x: px - 4 - w / 2, y: candidate.py - labelH - 6, penalty: lateFirst ? 1.5 : BESIDE_PENALTY },
            { slot: 'belowLeft', x: px - 4 - w / 2, y: candidate.py + 6, penalty: lateFirst ? 1.5 : BESIDE_PENALTY },
          ] : []),
        ]),
      ];
      // on a rank ladder a value under its point reads as the next
      // rank's; where a name stands beside the point, the value that finds
      // no seat over it folds into the name instead (layoutLine).
      const named = input.bump?.named?.has(`${input.series.id}:${candidate.ci}`) === true;
      slots = seats
        // A last value stays next to its point. A distant shifted row goes to the omission note.
        .filter((seat) => !last || continuedEnd || Math.max(seat.y - candidate.py, candidate.py - seat.y - labelH, 0) <= labelH)
        // On a rank ladder a value never sits under its point; with
        // the series gap kept, a value with no seat over its point goes to the note.
        .filter((seat) => !((named || input.bump) && seat.slot.startsWith('below')))
        .filter((seat) => input.fillTo === undefined || (seat.y + labelH / 2 - candidate.py) * (input.fillTo - candidate.py) <= 0)
        .map((seat) => ({ slot: seat.slot, rect: containedRect(bounds, seat.x, seat.y, w, labelH), penalty: seat.penalty ?? (seat.slot.endsWith('Right') ? 1.5 : order.indexOf(seat.slot)) }))
        .concat(rescue)
        .sort((a, b) => a.penalty - b.penalty)
        .flatMap((seat) => {
          const { slot, rect, penalty } = seat;
          const leaderFrom = 'leaderFrom' in seat ? seat.leaderFrom : undefined;
          if (rect === null) return [];
          // The line's claims carry the value's own owner, so
          // the solver would let the value onto its own line; the drawn
          // segments decide here, with the 2px stroke's half width plus 1px.
          if (ownQueries.some(stroke => stroke.hits(rect, 2))) return [];
          // A seat that draws its leader says whose it is, near a rival or not.
          if (leaderFrom) return [{ slot, rect, penalty, leaderFrom }];
          // the first value of a series that starts after the first
          // category keeps the seats a first value at index 0 has. There the other lines run on
          // both sides of the point, so every seat came out nearer one of them and the value had
          // no seat at all ("valid slots: none"). At index 0 nothing lies left of the point. The
          // solver's ownership pass (label/ownership.ts) still checks each seat against the other
          // points and puts a leader on a seat that does not read as its own.
          if (lateFirst || rivals.length === 0) return [{ slot, rect, penalty }];
          let own = Infinity;
          for (const stroke of ownQueries) own = Math.min(own, stroke.distance(rect));
          return rivals.some(stroke => stroke.distance(rect) < own) ? [] : [{ slot, rect, penalty }];
        });
    }
    // A continued edge can occupy the near seats; keep the existing higher seats and leaders.
    if (computed && !continuedEnd) slots = slots.filter(slot => !slot.leaderFrom && !/Shifted|Raised|Step/.test(slot.slot));
    if (!candidate.suppressed && !rest && !keep[index]) input.lost.thinned.push(name);
    input.labelRequests.push({ id: `point:${input.series.id}:${category.id}`, kind: 'point', role: composedTextRole(candidate.text), owner: { seriesId: input.series.id, categoryId: category.id }, text: candidate.text, lines: words?.lines ?? [candidate.text], ...words?.request, typeRole: 'label', font: input.labelFont, priority: candidate.priority, redundant, ...lost, ...restFields, candidates: slots, ...(computed && !input.highlighted && !continuedEnd ? { noLeader: true } : {}),
      // A value over a neighbour's point reads as that point's value.
      ...(input.isStacked || input.bump ? {} : { anchor: { x: input.xOf(candidate.ci), y: candidate.py }, ...(computed ? { ownStrokeClear: true } : {}) }) });
  });
}

/**
 * The points the point pass labels on each drawn series. `valueLabels` says
 * which points the ENGINE labels: none, the last, the first and
 * last, those plus the series' lowest and highest, or all. On a fully labelled
 * series with an authored valueLabels mode, cell labels supply text only.
 * Otherwise a string cell label also selects its point.
 */
export function pointLabelSelection(input: {
  /** Series whose first value is already printed in the range key. */
  firstWithheld?: ReadonlySet<Id>;
  valueLabels: ValueLabelMode;
  /** The author set options.valueLabels, rather than using the default mode. */
  valueLabelsAuthored: boolean;
  /** The series `seriesLabels: { only }` names; the others print no value either. */
  labelOnly: ReadonlySet<Id> | undefined;
  /** Series whose last value the first series of its printed-zero group prints. */
  lastWithheld: ReadonlySet<Id>;
  /** Series whose last value text is carried by the key or its own end label. */
  lastCarried?: ReadonlySet<Id>;
  contentOf: (kind: LabelKind, fallback: LabelContent) => LabelContent | null;
  /** The content of the printed values where labels.point does not set one. */
  valueContent: LabelContent;
  drawnSeries: NormSer[];
  pv: (number | null)[][];
  rowOf: Map<NormSer, number>;
  /** The points options.anomaly flagged: each prints its value in every mode, as a flagged column does. */
  flagged?: { seriesId: Id; at: ReadonlySet<number> };
  /** A plain line ('line') prints no extra last-actual value at an AC/FC split. */
  variant?: LineVariant;
}): { series: NormSer; dataIdx: number; row: (number | null)[]; content: LabelContent; only: number[]; lastActual?: number }[] {
  const pointContent = input.contentOf('point', input.valueContent);
  const content = pointContent ?? input.valueContent;
  const mode = pointContent === null ? 'none' : input.valueLabels;
  return input.drawnSeries.flatMap((series, dataIdx) => {
    if (input.labelOnly !== undefined && !input.labelOnly.has(series.id)) return [];
    const row = input.pv[input.rowOf.get(series)!]!;
    const drawn = row.flatMap((value, ci) => (value === null ? [] : [ci]));
    if (drawn.length === 0) return [];
    const first = drawn[0]!;
    const last = drawn[drawn.length - 1]!;
    const values = drawn.map((ci) => row[ci]!);
    const [min, max] = [minOf(values), maxOf(values)];
    const engine = mode === 'all' ? drawn
      : mode === 'extremes' ? drawn.filter((ci) => ci === first || ci === last || row[ci] === min || row[ci] === max)
        : mode === 'ends' ? [first, last]
          : mode === 'last' ? [last] : [];
    // On an AC/FC split the last actual is where the forecast starts from, so it prints too.
    // A plain line or a stack keeps its split in the dashes, the hatch and the divider; there the
    // extra value would crowd the last actual and be footnoted at 320 px.
    const fcStart = mode === 'none' || mode === 'all' || input.variant === 'line' || input.variant === 'stacked-area' ? -1 : series.scenario === 'FC' ? 0 : series.vals.findIndex((val) => val.scenario === 'FC');
    const lastActual = fcStart > 0 ? lastActualIndex(series, fcStart, false) : -1;
    const extra = lastActual >= 0 && row[lastActual] !== null && !engine.includes(lastActual) ? lastActual : -1;
    if (extra >= 0) engine.push(extra);
    const textOnly = input.valueLabelsAuthored && series.vals.every(cell =>
      cell.v === null || cell.labelOverride === false || typeof cell.labelOverride === 'string');
    const authored = textOnly ? [] : drawn.filter(ci => typeof series.vals[ci]?.labelOverride === 'string');
    // A flagged value prints in every mode but labels.point false, as a flagged column's does.
    const flagged = input.flagged?.seriesId === series.id && pointContent !== null ? drawn.filter((ci) => input.flagged!.at.has(ci)) : [];
    const withheld = input.lastWithheld.has(series.id) ? last : -1;
    // A zero-tail group cannot withhold authored text that has no other carrier.
    const keepAuthoredLast = typeof series.vals[last]?.labelOverride === 'string' && !input.lastCarried?.has(series.id);
    const only = [...new Set([...engine, ...authored, ...flagged])]
      .filter(ci => (ci !== withheld || keepAuthoredLast) && (ci !== first || !input.firstWithheld?.has(series.id)))
      .sort((a, b) => a - b);
    return only.length > 0 ? [{ series, dataIdx, row, content, only, ...(extra >= 0 ? { lastActual: extra } : {}) }] : [];
  });
}

/** What a value prints where labels.point sets no content: the value parts of a labels.series content list, else the number. */
export function defaultValueContent(variant: LineVariant, seriesValueContent: LabelContent | undefined): LabelContent {
  return seriesValueContent ?? (variant === 'stacked100-area' ? ['percent'] : ['absolute']);
}

/** Air between the plot edge and a value centred on the end point, or the latest-point ring. */
export const PLOT_END_AIR = 4;

/**
 * How far inside the plot the first and last category must sit so a value
 * centred on its point keeps PLOT_END_AIR to the plot edge. A stacked value
 * moves inward along its band instead and needs no room.
 */
export function pointLabelEndRoom(input: Parameters<typeof pointLabelSelection>[0] & Omit<PointLabelInput, 'series' | 'row' | 'content' | 'categoryIndices'> & { isStacked: boolean;
  /** A continuous axis's last point stands at the plot end: its room counts the to-date words under the value. */
  endToDate?: ToDateWords }): { left: number; right: number } {
  const room = { left: 0, right: 0 };
  const last = input.cats.length - 1;
  if (input.isStacked || last < 0) return room;
  for (const pick of pointLabelSelection(input)) {
    const categoryIndices = pick.only.filter((ci) => ci === 0 || ci === last);
    for (const seed of pointLabelSeeds({ ...input, series: pick.series, row: pick.row, content: pick.content, categoryIndices })) {
      if (seed.suppressed) continue;
      if (seed.ci === 0) room.left = Math.max(room.left, seed.w / 2 + PLOT_END_AIR);
      const words = seed.ci === last && input.endToDate?.ids.has(input.cats[last]!.id)
        ? toDateLabel(seed.text, input.labelFont, input.endToDate.words, input.endToDate.theme, input.endToDate.measure).size.width : seed.w;
      if (seed.ci === last) room.right = Math.max(room.right, words / 2 + PLOT_END_AIR);
    }
  }
  return room;
}

/** The width of each value the point pass prints, keyed `${seriesId}:${categoryIndex}`. */
export function pointValueWidths(input: Parameters<typeof placePointValueLabels>[0]): Map<string, number> {
  const widths = new Map<string, number>();
  for (const { series, row, content, only } of pointLabelSelection(input)) {
    for (const seed of pointLabelSeeds({ ...input, series, row, content, categoryIndices: only })) {
      if (!seed.suppressed) widths.set(`${series.id}:${seed.ci}`, seed.w);
    }
  }
  return widths;
}

export function placePointValueLabels(input: Parameters<typeof pointLabelSelection>[0] & {
  drawnEdges?: ReadonlyMap<Id, { runs: Point[][]; bottom?: Point[] }>;
  cats: Category[];
  variant: LineVariant;
  rebased: boolean;
  composeText: ComposeText;
  composeEndText?: ComposeText;
  absOf: (series: NormSer, categoryIndex: number) => number | null;
  measure: TextMeasurer;
  labelFont: FontSpec;
  highlights: Set<Id>;
  isStacked: boolean;
  y: (value: number) => number;
  cumTop: number[][];
  cumBot: number[][];
  xOf: (categoryIndex: number) => number;
  plot: Rect;
  paintedAreaCats: Map<Id, Set<number>>;
  areaFillPaint: (series: NormSer, dataIdx: number) => Paint;
  paintCss: (paint: Paint) => string;
  labelH: number;
  step: number;
  density: NonNullable<LineOptions['labelDensity']>;
  labelRequests: LabelRequest[];
  /** A series whose values the chart hides and names in the note line (a Rest series, labels.restSeries). */
  restHidden?: (series: NormSer) => boolean;
  interpolationFor: (series: NormSer) => LineInterpolation;
  sharesWithheld: ReadonlySet<Id>;
  endUnitSuffix: string;
  unitOnEvery: boolean;
  /** The series whose name stands at their line end; the others' last value may sit beside the point. */
  endNamed: ReadonlySet<Id>;
  warnings: LintWarning[];
  /** Each forecast split: its x, on the last actual point, and that point's category. */
  dividers: readonly { x: number; ci: number }[];
  /**
   * A rank chart: every value sits over its own point first, and the top
   * rank's may use the band over the plot. `named` holds the
   * points a name stands beside, `${seriesId}:${categoryIndex}`.
   */
  bump?: { headroom: number; named?: ReadonlySet<string> };
  /** The bold face of a focus series' values (lineFocusFont). */
  focusFont?: FontSpec;
  /** The running categories whose values print the to-date words under them (lineToDateIds). */
  toDate?: ToDateWords;
}): void {
  const lost = { sliver: [] as string[], thinned: [] as string[] };
  const strokesOf = new Map(input.drawnSeries.map((series) => {
    const row = input.pv[input.rowOf.get(series)!]!;
    const runs = input.isStacked ? [] : input.drawnEdges?.get(series.id)?.runs ?? drawnRuns(row, series.interpolateGaps).map((run) =>
      drawnStroke(run.map((ci) => ({ x: input.xOf(ci), y: input.y(row[ci]!) })), input.interpolationFor(series)));
    const stroke = { runs, queries: undefined as PolylineQueries[] | undefined };
    return [series.id, stroke] as const;
  }));
  for (const { series, dataIdx, row, content, only, lastActual } of pointLabelSelection(input)) {
    const seriesFont = input.focusFont && input.highlights.has(series.id) ? input.focusFont : input.labelFont;
    const candidates = buildPointCandidates({ ...input, labelFont: seriesFont, series, dataIdx, row, content, categoryIndices: only });
    // A value near its forecast divider moves to the actual side,
    // clear of the divider claim and the solver's 2px pad.
    for (const candidate of candidates) {
      const divider = input.dividers.find((split) => split.ci === candidate.ci && Math.abs(split.x - candidate.x) < candidate.w / 2 + 3);
      if (divider !== undefined) candidate.x = divider.x - 3 - candidate.w / 2;
    }
    const own = strokesOf.get(series.id)!;
    const ownQueries = own.queries ??= own.runs.map(preparePolyline);
    const others: Point[][] = [];
    const otherQueries: PolylineQueries[] = [];
    for (const [id, stroke] of strokesOf) {
      if (id === series.id) continue;
      for (const run of stroke.runs) others.push(run);
      for (const query of stroke.queries ??= stroke.runs.map(preparePolyline)) otherQueries.push(query);
    }
    const edge = (cum: number[][]) => drawnStroke(input.cats.map((_, ci) => ({ x: input.xOf(ci), y: input.y(cum[dataIdx]![ci]!) })), input.interpolationFor(series));
    const drawn = input.drawnEdges?.get(series.id);
    const bandEdges = input.isStacked ? { top: drawn?.runs.flat() ?? edge(input.cumTop), bottom: drawn?.bottom ?? edge(input.cumBot) } : undefined;
    const namedEnd = input.valueLabels !== 'all' && !input.isStacked && !input.bump && (input.endNamed.has(series.id)
      || input.labelRequests.some(request => request.kind === 'series' && request.owner.seriesId === series.id));
    // Every highlight mode, fade included: fade has no focus font, but its focus value needs the seat too.
    pushPointRequests({ continued: input.drawnEdges !== undefined, highlighted: input.highlights.has(series.id) && !input.bump && input.variant === 'line', regularRow: input.valueLabels === 'all' && !input.isStacked, namedEnd, candidates, series, cats: input.cats, isStacked: input.isStacked, variant: input.variant, labelH: input.labelH, step: input.step, density: input.density, plot: input.plot, labelFont: seriesFont, labelRequests: input.labelRequests, ownQueries, others, otherQueries, xOf: input.xOf, besideLast: !input.endNamed.has(series.id), ...(bandEdges ? { bandEdges } : {}), ...(input.bump ? { bump: input.bump } : {}), topBand: input.isStacked && dataIdx === input.drawnSeries.length - 1, row, ...(input.isStacked ? { painted: input.paintedAreaCats.get(series.id) } : {}), ...(input.variant === 'area' && input.drawnSeries.length > 1 && input.paintedAreaCats.has(series.id) ? { fillTo: input.y(0) } : {}), lost, restHidden: input.isStacked && input.restHidden?.(series) === true, ...(input.toDate ? { toDate: input.toDate } : {}) });
    // The last actual's value is an extra the default adds where a seat is free;
    // with none it gives way quietly, as no default promised it.
    // An authored cell label is the author's, not the default's: it keeps its note.
    const extra = lastActual === undefined || typeof series.vals[lastActual]?.labelOverride === 'string' ? undefined : input.labelRequests.find((request) => request.id === `point:${series.id}:${input.cats[lastActual]!.id}`);
    if (extra) {
      extra.quietWhenCrowded = true;
      if (extra.redundant && extra.suppressedAs === 'density') delete extra.suppressedAs;
    }
  }
  // A value that is not on the page is said, not dropped in silence.
  // An area band too thin or too short for its value has no seat a density or a pin could open:
  // only more room or a shorter value restores it.
  warnSliverLabels(input.warnings, lost.sliver, 'widen or heighten the chart, or shorten the values with a coarser format');
  if (lost.thinned.length > 0) {
    const shown = lost.thinned.slice(0, 5).join(', ') + (lost.thinned.length > 5 ? ', ...' : '');
    input.warnings.push({
      code: 'point-labels-thinned',
      severity: 'info',
      message: `${lost.thinned.length} point value${lost.thinned.length === 1 ? ' is' : 's are'} not printed because ${lost.thinned.length === 1 ? 'it' : 'each'} would overlap a neighbouring value of its series (${shown})`,
      suggest: 'widen the chart, or label fewer points',
    });
  }
}

export function placeCategoryLabels(input: {
  show: boolean;
  plan: CategoryRowPlan;
  cats: Category[];
  xOf: (categoryIndex: number) => number;
  plot: Rect;
  labelRequests: LabelRequest[];
}): boolean {
  if (!input.show) return false;
  const rotated = input.plan.rotation !== 0;
  const bottom = input.plot.y + input.plot.h;
  input.cats.forEach((category, ci) => {
    const info = input.plan.infos[ci]!;
    input.labelRequests.push({
      id: `category:${category.id}`,
      kind: 'category',
      owner: { categoryId: category.id },
      text: category.label ?? category.id,
      lines: info.lines,
      ...categoryLineAlign(input.plan, ci),
      ...(info.title !== undefined ? { title: info.title } : {}),
      typeRole: input.plan.typeRole, font: input.plan.font,
      priority: PRIORITY.endpoint,
      redundant: !input.plan.keep[ci],
      ...(rotated ? { rotate: -45 } : {}),
      candidates: rotated
        ? [{ slot: 'below', rect: rotatedClaimRect(input.xOf(ci), bottom + Math.max(9, info.h * Math.SQRT1_2 / 2 + 6), info.h), penalty: 0 }]
        : [{ slot: 'below', rect: { x: input.plan.x(ci), y: bottom + 6, w: info.w, h: info.h }, penalty: 0 }],
    });
  });
  pushAll(input.labelRequests, yearRowRequests(input.plan, bottom + 6));
  return true;
}

/** The visible points options.anomaly flagged on a line, for pointLabelSelection. */
export function flaggedPoints(domain: { anomaly?: { model: { flagByCategory: ReadonlyMap<Id, unknown> }; seriesId: Id }; cats: { id: Id }[] }): { seriesId: Id; at: ReadonlySet<number> } | undefined {
  const anomaly = domain.anomaly;
  if (!anomaly) return undefined;
  return { seriesId: anomaly.seriesId, at: new Set(domain.cats.flatMap((c, ci) => (anomaly.model.flagByCategory.has(c.id) ? [ci] : []))) };
}
