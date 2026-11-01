import { boundsOf, type Rect, type Size } from './geometry';
import { NormalizeError, resolveSize, resolveSubtitle } from './normalize/shared';
import { panelTypeClass, WIDE_CANVAS_MIN_WIDTH } from './theme';
import { DEFAULT_TARGET, resolveTargetSize, TARGET_SIZE, type TargetSizeOptions } from './target';
import { getChart, type ChartCore, type ChartOptions } from './registry';
import { singleStops } from './strings';
import type { Geometry, LayoutResult, PlacedLabel, RefusedLayout } from './types/scene';
import type { ChartSizing, ResolvedSizing } from './types/sizing';
import type { BaseOptions, RenderTarget } from './types/options';
import { compactOptions, MOVED_SUBTITLE, omittedCompactNotes } from './compact';
import { COMPACT_SOURCE_LINES, frameTextOptions, freedChromeOf, plotChromeFloor, settledAutoHeight, subtitleLine } from './frame';
import { aspectClassFor, furnitureBudget, furnitureScoped, ladderHeights, LADDER_TOLERANCE } from './aspect';
import { isVarianceTier } from './grid/varianceTiers';
import { isRefused } from './schema/refusals';
import { AUTO_LEGEND } from './legendPolicy';
import { copyFrame, liveFooterExtra, partNeedOf, staticFrame } from './footer';
import { rankKeyShown, withEngineNotes } from './notes';
import { withCategoryRowPlans } from './label/categoryRow';
import { maxOf } from './arrays';
import { sourceFollowsContent } from './sourceFollows';

const ROW_TYPES = new Set(['bar', 'bartable', 'bullet', 'butterfly', 'gantt', 'likert', 'cohort', 'table', 'funnel', 'status', 'heatmap']);
/** Row charts whose width floor is their measured content. Table keeps its own 100 px. */
const ROW_FAMILY = ['bar', 'bartable', 'funnel', 'butterfly', 'likert', 'status', 'gantt', 'cohort', 'heatmap', 'bullet'];
/** Charts on a band scale whose width floor is their measured content. */
const BAND_FAMILY = ['waterfall', 'pareto', 'variance', 'pyramid', 'box', 'mekko', 'pvm'];
/**
 * The static width floor of the row and band families: a dashboard card. Above it the
 * layout's measured content width gates (`resolveSizing` takes the larger), so a chart
 * draws full where its content fits and compact below that.
 */
export const CARD_MIN_WIDTH = 280;
/** Canvases narrower than this are cards: a fill chart there is never shorter than at this width. */
export const CARD_CLASS_WIDTH = 480;
/** The card widths a host steps through; each card is no shorter than the next wider one. */
const CARD_STEPS = [400, CARD_CLASS_WIDTH];
/**
 * Types whose marks scale with the width take the height of their content,
 * so a narrower card of them may be shorter. Tilemap tiles are the plot width over the columns.
 */
export const WIDTH_SCALED_TYPES: ReadonlySet<string> = new Set(['pie', 'waffle', 'choropleth', 'sparkline', 'tilemap']);
/** Content types whose height can fall at a narrower card (smaller row pitch, cell or node size): they take the next wider card's height. */
const CARD_FLOOR_CONTENT_TYPES: ReadonlySet<string> = new Set(['butterfly', 'diagram', 'funnel', 'grid', 'heatmap', 'kpi', 'status']);
// Every row and band type takes the card floor. A status layout measures its own width floor (row
// band, one px per column and the end headers), so it has no compact floor, and its repair, like a
// bullet's, keeps the height measured at the repaired width.
const REPAIR_PROBE_TYPES = new Set(['status', 'bullet']);
const CARD_FLOOR_TYPES = new Set([...ROW_FAMILY, ...BAND_FAMILY]);
// A map's height is its content too: the pack's aspect at the width it gets, plus its text.
const CONTENT_TYPES = new Set([...ROW_TYPES, 'kpi', 'pie', 'diagram', 'sparkline', 'slope', 'choropleth']);

/**
 * Types that draw down to a narrow column instead of refusing. A dashboard
 * puts these in narrow slots, and a refusal there leaves an empty box where a
 * readable small chart fits.
 *
 * The floors are per type because one pair does not fit all of them. Measured
 * on each type's example fixture: a column keeps 85px of plot at 320x180,
 * while a line keeps 21px and a scatter 35px — a strip, not a chart. At
 * 320x240 those two keep 81px and 95px. A row chart's height comes from its row
 * count, so only its width floor moves. The width is 280 px: a 360 px phone with a
 * 16 px page gutter and a 24 px card padding leaves 280 px, and compact keeps its
 * text sizes there (scaling a 320 px drawing down
 * would put 11 px text at 9.6 px).
 *
 * Every row and band chart has a compact form. Its static width floor is
 * CARD_MIN_WIDTH, so compact is not a width band below a static minimum: full draws where the
 * measured content fits, and compact runs when full refuses on width (`compactFallbackApplies`).
 * Band charts hold their plot at MIN_COMPACT_PLOT (HOLDS_COMPACT_PLOT). Left out:
 * - area variants: they are `line` and already share its floor;
 * - mekko: its `variant` names its calculation, not a density, so it has no compact form;
 * A slope draws a pinned height under 270 px down to 180 px while its end labels fit and its plot keeps MIN_COMPACT_PLOT.
 */
const ROW_COMPACT_FLOOR = { width: CARD_MIN_WIDTH, height: 28 };
const BAND_COMPACT_FLOOR = { width: CARD_MIN_WIDTH, height: 180 };
const COMPACT_FLOORS: Record<string, { width: number; height: number }> = {
  column: { width: 280, height: 180 },
  line: { width: 280, height: 180 },
  scatter: { width: 280, height: 240 },
  dot: { width: 280, height: 240 },
  combo: { width: 280, height: 240 },
  histogram: { width: 280, height: 240 },
  treemap: { width: 280, height: 180 },
  pie: { width: 280, height: 160 },
  slope: { width: 280, height: 180 },
  // A grid at the shared minimum height: its compact form (one column of panels) is only the
  // fallback of a refused full layout (FALLBACK_COMPACT), never a band under its minimum.
  grid: { width: 280, height: 270 },
  // A bullet has no compact form under mode 'compact' (only density 'compact'), so it has no compact floor: its measured width gates.
  ...Object.fromEntries(ROW_FAMILY.filter((type) => type !== 'status' && type !== 'bullet').map((type) => [type, ROW_COMPACT_FLOOR])),
  ...Object.fromEntries(BAND_FAMILY.filter((type) => type !== 'mekko').map((type) => [type, BAND_COMPACT_FLOOR])),
};

/**
 * A received size this many px under a minimum still fits. Browsers lay a card out in
 * fractions of a pixel (777.984375 for a 778 px minimum), and a refusal over 0.016 px
 * leaves an empty box where the chart fits. Every type shares this one tolerance.
 */
export const SIZE_TOLERANCE = 0.5;

/**
 * Types that compact only when the full layout refuses: a grid's panels already draw
 * compact on a card (grid `compactPanelMode`), and a short grid keeps its full frame.
 */
const FALLBACK_COMPACT: ReadonlySet<string> = new Set(['grid']);

/** Below the type's own minimum on either axis, and the host has not asked for a refusal there. */
function belowMinimum(policy: ChartSizing, size: Size, options: { belowMinimum?: unknown } | undefined, type: string): boolean {
  return policy.compactFloor !== undefined && options?.belowMinimum !== 'refuse' && !FALLBACK_COMPACT.has(type) && !fitsSize(size, policy);
}

/** A plot under this height is a strip, not a chart: the compact height ladder then drops the subtitle. */
const MIN_COMPACT_PLOT = 80;
/**
 * Types that also hold their plot at MIN_COMPACT_PLOT in compact mode, by refusing with the
 * measured height. A line with a title, a time axis and end labels keeps 21px of plot at
 * 320x180 without it. Scatter and dot are left out: the scatter example slot (380x241) keeps
 * a plot of about 64 px by design, and a dot's compact band has its own floor.
 * This holds whenever the chart draws compact, not only when the height is short: a canvas
 * short only in width would draw a 70 px histogram plot at 320x270. For a column at 320 wide, a
 * fixed slot would keep a one-line source over a 58 px plot at 306 px, where 304 px drops the
 * source and keeps 82 px. Held, the source line comes back only above the height that keeps the
 * plot at 80 px.
 */
const HOLDS_COMPACT_PLOT = new Set(['column', 'line', 'combo', 'histogram', 'slope', ...BAND_FAMILY.filter((type) => type !== 'mekko')]);
/**
 * Refuse-less: the plot a pinned frame keeps at the type's hard minimum
 * in place of MIN_COMPACT_PLOT. It holds two labelled value ticks and
 * marks that still read apart; a chart's own measured needs (value rows, end labels) still gate.
 */
export const HARD_COMPACT_PLOT = 40;
/** Types whose plot keeps MIN_COMPACT_PLOT at the hard minimum too: a slope under 80 px packs its lines into one band. */
const HARD_KEEPS_COMPACT_PLOT = new Set(['slope']);

/**
 * Whether a chart with two or more drawn series names each of them on the canvas: a key label,
 * a series or line-end label, an axis title, or a text the series owns that holds its name
 * (as the layout scorecard reads it). The hard minimum must not trade the series key
 * for a smaller canvas. A series without drawn data ink needs no name.
 */
function namesDrawnSeries(data: unknown, result: unknown): boolean {
  const series = (data as { series?: { id?: unknown; label?: unknown }[] } | undefined)?.series;
  const entries = (Array.isArray(series) ? series : []).filter((entry) => typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id as string, name: typeof entry.label === 'string' ? entry.label : entry.id as string }));
  if (entries.length < 2) return true;
  type Node = { t?: string; d?: string; lines?: string[]; part?: string; opacity?: number; owner?: { seriesId?: string };
    origin?: { owner?: { seriesId?: string } }; children?: unknown[] };
  const naming = new Set(['legendLabel', 'series', 'lineEnd', 'seriesName', 'axisTitle']);
  const keyInk = new Set(['swatch', 'legendKey', 'legendLine']);
  const active = new Set<string>();
  const named = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const item = node as Node;
    const owner = item.owner?.seriesId ?? item.origin?.owner?.seriesId;
    if (owner !== undefined && item.opacity !== 0) {
      if (item.t === 'text' && Array.isArray(item.lines)) {
        const text = item.lines.join(' ');
        const entry = entries.find((candidate) => candidate.id === owner);
        if (text.trim() !== '') {
          if (['point', 'segment', 'total', 'grandTotal'].includes(item.part ?? '')) active.add(owner);
          if (entry && (naming.has(item.part ?? '') || text.includes(entry.name))) named.add(owner);
        }
      } else if (!keyInk.has(item.part ?? '') && (item.t !== 'path' || /[LCHV]/i.test(item.d ?? ''))) active.add(owner);
    }
    if (Array.isArray(item.children)) item.children.forEach(walk);
  };
  ((result as { scene?: unknown[] }).scene ?? []).forEach(walk);
  const drawn = entries.filter((entry) => active.has(entry.id));
  return drawn.length < 2 || drawn.every((entry) => named.has(entry.id));
}

/** Whether this layout runs at the type's hard minimum (the last fixed-slot step before a refusal). */
export function atHardMinimum(options: unknown): boolean {
  return (options as { [HARD_MINIMUM]?: boolean } | undefined)?.[HARD_MINIMUM] === true;
}

/**
 * Value-label rows a chart's plot keeps before a pinned frame gives up: three
 * comfortably, two at the hard minimum, which still holds two labelled value ticks.
 */
export function plotFloorRows(options: unknown): number {
  return atHardMinimum(options) ? 2 : 3;
}

/**
 * The floor a request is measured against per dimension. A type whose own
 * minimum is already below the compact floor keeps its own; the compact floor
 * lowers a bound, it never raises one.
 */
function requestFloor(policy: ChartSizing): { width: number; height: number } {
  const compact = policy.compactFloor;
  return compact
    ? { width: Math.min(compact.width, policy.minWidth), height: Math.min(compact.height, policy.minHeight) }
    : { width: policy.minWidth, height: policy.minHeight };
}

/**
 * A diagram's content height may go below the
 * shared 270 px minimum (the customer journey needs 204 px at 960 and 720). A diagram's
 * floor is DIAGRAM_MIN_HEIGHT and its content sets the rest.
 */
export const DIAGRAM_BELOW_SHARED_MIN = true;
export const DIAGRAM_MIN_HEIGHT = 160;

/**
 * Default sizing for built-in types and compatible third-party definitions.
 *
 * `options` is read for the one option that moves a floor: a KPI card at
 * `density: 'compact'` keeps the 280 px card floor (CARD_MIN_WIDTH), the
 * tile a dashboard puts nine of in a row. It keeps every part of the card, so
 * this is a smaller card and not a poorer one. A KPI card's height floor is
 * measured from its content like a row chart's: an unsized card takes
 * the height of its content, so a static 144 would pad a value-only card.
 */
export function chartSizing(type: string, options?: { density?: unknown }): ChartSizing {
  const compactKpi = type === 'kpi' && options?.density === 'compact';
  // A compact bullet is a 120 px mark in a KPI column.
  const compactBullet = type === 'bullet' && options?.density === 'compact';
  const cardFloor = CARD_FLOOR_TYPES.has(type);
  return {
    aspect: type === 'scatter' ? '4:3' : type === 'pie' ? '1:1' : CONTENT_TYPES.has(type) ? 'content' : '16:9',
    minWidth: type === 'table' ? 100 : type === 'sparkline' ? 88 : compactKpi ? 280 : compactBullet ? 120
      : type === 'kpi' || type === 'pie' || type === 'choropleth' || cardFloor ? CARD_MIN_WIDTH : CARD_CLASS_WIDTH,
    minHeight: type === 'scatter' ? 360 : type === 'pie' ? 320 : type === 'table' ? 80 : type === 'sparkline' ? 24 : ROW_TYPES.has(type) || type === 'kpi' ? 28
      : type === 'diagram' && DIAGRAM_BELOW_SHARED_MIN ? DIAGRAM_MIN_HEIGHT : 270,
    fit: CONTENT_TYPES.has(type) ? 'content' : 'fill',
    // A compact-density bullet is already its smallest form at 120 px: the row compact floor would raise it.
    ...(Object.hasOwn(COMPACT_FLOORS, type) && !compactBullet ? { compactFloor: COMPACT_FLOORS[type] } : {}),
  };
}

/**
 * The sizing contract. A chart its host did not pin (no `options.size`,
 * not a grid panel) takes the height of its content, from title to source:
 * row charts and the creative card through `rowDrivenHeight`, the kpi card
 * and the diagram by laying out again at their measured natural height, a
 * slope in `fitLayout`. A pinned chart keeps its
 * size and grows its rows, cells or cards into the frame up to a thickness
 * cap (`capPitch`); what the cap leaves over stays empty below the content.
 *
 * A height taken from the content is not a canvas proportion, so the
 * canvas-proportion lints (the size ladder, the plot share, the furniture
 * budget, the flat side of the aspect cap) do not judge a chart for
 * which this returns true. `fit` is the definition's declared fit, which a
 * laid-out chart carries as `geometry.sizing.fit` (creative declares its own);
 * without it the built-in policy for the type answers.
 */
export function contentSized(type: string, options?: { size?: unknown }, fit: ChartSizing['fit'] = chartSizing(type).fit): boolean {
  return (heightOmitted(options?.size) || type === 'grid') && panelTypeClass(options) === undefined && fit === 'content';
}

/** A size that pins the width and leaves the height to the chart. */
function widthOnly(size: unknown): size is { width: number } {
  return typeof size === 'object' && size !== null && (size as { height?: unknown }).height === undefined;
}

/** Layout and height warnings use the same definition of an automatic height. */
export function heightOmitted(size: unknown): boolean {
  return size === undefined || widthOnly(size);
}

/**
 * The pitch of `count` rows, cells or cards sharing `room` px of a pinned
 * frame, never thicker than `cap`. Below the cap the content fills the
 * frame; at the cap the rest of the frame stays empty.
 */
export function capPitch(room: number, count: number, cap: number): number {
  return Math.min(cap, room / Math.max(1, count));
}

/**
 * The height a fill chart wants at a width: its preferred aspect, rounded to
 * the pixel the height ladder uses (489 wide at 16:9 is 275). A fill chart
 * stretches to any height it is given, so the accepted canvas height says
 * nothing about what it needs.
 */
function aspectHeight(policy: ChartSizing, size: Size): number {
  const [w, h] = policy.aspect.split(':');
  return policy.fit === 'fill' && h ? Math.round((size.width * +h) / +w!) : size.height;
}

/**
 * The height a filling chart takes at a width when its host has no height of
 * its own (a card whose height is its content): its aspect, and never less
 * than the floor it is measured against, so a narrow host draws the compact
 * chart instead of a refusal.
 */
/**
 * A fill chart taller than 16:9 (the 4:3 scatter) starts no taller than its aspect height at
 * this width below the wide class. The scatter keeps its 720 px field (527 px) at 960
 * (547 px); 4:3 of 960 would start it at 720 px.
 */
const TALL_ASPECT_CAP_WIDTH = 720;

export function hostlessHeight(policy: ChartSizing, width: number, fallbackHeight: number, card = false): number {
  const full = aspectHeight(policy, { width, height: fallbackHeight });
  const aspect = card && policy.fit === 'fill' && policy.aspect !== '16:9' && width < WIDE_CANVAS_MIN_WIDTH
    ? Math.min(full, aspectHeight(policy, { width: TALL_ASPECT_CAP_WIDTH, height: fallbackHeight })) : full;
  // A card starts at the type's own minimum height, never at a 16:9 strip of a
  // narrow width; the plot floor then grows it (`plotFloorHeight`).
  const floor = card && policy.fit === 'fill' ? policy.minHeight : requestFloor(policy).height;
  // A fill chart does not start at 16:9 (540 px at 960); it starts at its minimum and the
  // plot reserve (`autoPlotPx`) grows it to its content. The wide class keeps 16:9.
  if (card && policy.fit === 'fill' && policy.aspect === '16:9' && width < WIDE_CANVAS_MIN_WIDTH) return floor;
  // Below the wide class a card whose floor is above its aspect height
  // takes the floor in whole px, not the next ladder step (960 px at a4 would be 681 px for a
  // 456 px floor). The wide class keeps the ladder.
  if (card && policy.fit === 'fill' && floor > aspect && width < WIDE_CANVAS_MIN_WIDTH) return Math.ceil(floor);
  return policy.fit === 'fill' && floor > aspect
    ? ladderHeights(width).find(step => step.height >= floor)?.height ?? floor : Math.max(floor, aspect);
}

/**
 * An automatic height reserves the plot first. The plot
 * keeps at least PLOT_FLOOR_SHARE of the canvas and at least this many px per target; title
 * lines, key, annotations and notes then grow the frame. One value per target: a dashboard
 * card is denser than a page, so it keeps 140 px, every other target 160 px.
 */
export const PLOT_FLOOR_PX: Readonly<Record<RenderTarget, number>> = { report: 160, print: 160, slide: 160, dashboard: 140 };
export const PLOT_FLOOR_SHARE = 0.5;
/** Below this canvas width the automatic height keeps a smaller plot share. */
export const NARROW_SHARE_WIDTH = 600;
export const NARROW_PLOT_FLOOR_SHARE = 0.4;

/**
 * The plot share an automatic height keeps at this width. A narrow card keeps about 40% plot
 * under a wrapped title, key and notes; 0.5 would make those cards too tall.
 */
export function plotFloorShare(width: number, options?: object): number {
  if (options !== undefined) shareRead = true;
  const chosen = (options as { [PLOT_SHARE]?: number } | undefined)?.[PLOT_SHARE];
  if (chosen !== undefined) return chosen;
  return width < NARROW_SHARE_WIDTH ? NARROW_PLOT_FLOOR_SHARE : PLOT_FLOOR_SHARE;
}

/**
 * The plot share the automatic-height search keeps for this chart: plotFloorShare for a 16:9
 * fill chart, 0.5 for a scatter (4:3 start) and a waterfall. The layout scorecard reads
 * the same rule.
 */
export function autoPlotShare<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, options: O | undefined, width: number,
): number {
  return declaredSizing(definition, options).aspect === '16:9' && definition.type !== 'waterfall'
    ? plotFloorShare(width, options) : PLOT_FLOOR_SHARE;
}

/**
 * The plot share the outermost layout call chose. A narrow card at automatic
 * height keeps 0.4 only when no value moves into a note because of it; the registry then lays
 * the chart out again with 0.5 here and keeps the layout that hides less.
 */
export const PLOT_SHARE = Symbol('boardplot.plotShare');
/**
 * Whether the running layout read a plot share from its options (plotFloorShare). Most layouts
 * never do, so the request memo keys only those that did by the share: the 0.5 pass
 * then reuses every layout of the 0.4 pass whose inputs are otherwise equal.
 */
let shareRead = false;

/**
 * Set on a value the layout seats only in its digit seat (a column sliver), after every other
 * label: how the size searches saw it before that seat. `noted` is true where the note would
 * name it; `lineH` is the height of its line box. The searches count it as hidden there, so
 * the seat keeps a value on the chart and never changes the height they choose.
 */
export const DIGIT_SEAT = Symbol('boardplot.digitSeat');
export interface DigitSeated { [DIGIT_SEAT]?: { noted: boolean; lineH: number } }

/** A value the note names, or one only its digit seat holds where the note would name it. */
function notedForSize(label: PlacedLabel): boolean {
  return label.noted === true || (label as DigitSeated)[DIGIT_SEAT]?.noted === true;
}

/**
 * Values and names a layout hid for want of room: the ones its notes name or count, and the
 * ones a collision or the density thinning hid. An axis tick is not counted.
 */
export function hiddenForSpace<M extends object, D extends object>(result: LayoutResult<M, D>): number {
  if (result.refused) return Infinity;
  return result.labels.filter((label) => notedForSize(label) || label.noteCounted
    || ((label.hidden === 'collision' || label.hidden === 'density') && label.kind !== 'tick')).length;
}

/**
 * Whether the narrow 0.4 share applies to this call: an automatic height below
 * NARROW_SHARE_WIDTH, a 16:9 fill chart that is not a grid panel, and not a scatter or waterfall
 * (both keep 0.5), with no share chosen yet.
 */
export function narrowShareApplies<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, options: O | undefined,
): boolean {
  if (!options || !widthOnly(options.size) || PLOT_SHARE in options || panelTypeClass(options) !== undefined) return false;
  // An unpinned treemap or sankey takes the plot its content wants,
  // so the 0.5 share would lay out the same chart again (treemap.circle at 320: 27 passes, half of them repeats).
  if (definition.type === 'grid' || definition.type === 'waterfall' || definition.type === 'treemap' || definition.type === 'sankey') return false;
  const declared = declaredSizing(definition, options);
  return declared.fit !== 'content' && declared.aspect === '16:9'
    && plotFloorShare(resolveSize(options.size, options.target).width) < PLOT_FLOOR_SHARE;
}

/** Header rows inside a plot do not count toward its data-height floor. */
export const PLOT_FLOOR_RECT = Symbol('boardplot.plotFloorRect');
function plotForFloor(geometry: Pick<Geometry, 'plot'> & { [PLOT_FLOOR_RECT]?: Rect }): Rect {
  return geometry[PLOT_FLOOR_RECT] ?? geometry.plot;
}

/**
 * The content plot height. A fill chart whose rows set its plot (dot rows at their pitch)
 * reports the plot height its content needs at this width. An automatic height
 * then gives the plot that height: `exact` takes it as is (it can be above or below the plot
 * floor); otherwise it only caps the plot floor, so a few rows give a shorter canvas. The
 * search stops at the first canvas that holds it. A pinned height ignores it.
 */
export const CONTENT_PLOT_HEIGHT = Symbol('boardplot.contentPlotHeight');
export interface ContentPlotHeight { readonly px: number; readonly exact: boolean }
type ContentSized = { [CONTENT_PLOT_HEIGHT]?: ContentPlotHeight };

/**
 * The canvas height an automatic height needs for this laid-out chart (plotFloorHeight, or the
 * content plot height when the chart reports one), and whether this canvas already holds it.
 */
function autoHeightNeed(geometry: Pick<Geometry, 'size' | 'plot'> & { frame?: Geometry['frame'] } & ContentSized, target: RenderTarget, plotPx: number,
  share: number, freed: number): { need: number; holds: boolean } {
  // A frame part that gave way (footer.ts recordPartNeed) needs at least its own canvas height.
  const part = partNeedOf(geometry.frame);
  const need = Math.max(plotFloorHeight(geometry, target, plotPx, share, freed), part);
  const content = geometry[CONTENT_PLOT_HEIGHT];
  if (content === undefined) return { need, holds: false };
  const H = geometry.size.height;
  const chrome = H - geometry.plot.h + freed;
  const floor = Math.ceil(Math.max(chrome + plotPx, chrome / (1 - share)) - 1e-6);
  const contentNeed = Math.ceil(H - geometry.plot.h + content.px - 1e-6);
  if (!content.exact && contentNeed >= floor) return { need, holds: false };
  return { need: Math.max(H, contentNeed, part), holds: H >= contentNeed && H >= part };
}

/** The canvas height at which a laid-out chart's plot meets its floor, assuming the frame around it keeps its height. */
export function plotFloorHeight(geometry: Pick<Geometry, 'size' | 'plot'>, target: RenderTarget, plotPx = PLOT_FLOOR_PX[target],
  share = plotFloorShare(geometry.size.width), freed = 0): number {
  const chrome = geometry.size.height - plotForFloor(geometry).h + freed;
  return Math.ceil(Math.max(geometry.size.height, chrome + plotPx, chrome / (1 - share)) - 1e-6);
}

/** Includes frame space that a taller chart restores and the chart's certified chrome floor. */
export function plotRepairHeight(geometry: Pick<Geometry, 'size' | 'plot' | 'frame'>, target: RenderTarget): number {
  const chrome = geometry.size.height - plotForFloor(geometry).h;
  const certified = plotChromeFloor.get(geometry.frame) ?? chrome;
  return plotFloorHeight(geometry, target, undefined, undefined,
    freedChromeOf(geometry.frame) + Math.max(0, certified - chrome));
}

/**
 * The plot an automatic height reserves, by canvas width: a fill chart gets about 260 px of
 * plot at 960, 235 at 720 and 185-215 on cards, not a 16:9
 * canvas: 150 px + 11.5% of the width, never under the target's plot floor. The
 * chart's frame (title, key, notes) then adds its own height. A pinned height keeps
 * the plain floor (PLOT_FLOOR_PX). The wide class (W-L, from 1080 px) keeps its 16:9 start.
 */
export function autoPlotPx(target: RenderTarget, width: number): number {
  return width >= WIDE_CANVAS_MIN_WIDTH ? PLOT_FLOOR_PX[target] : Math.max(PLOT_FLOOR_PX[target], Math.round(150 + 0.115 * width));
}

/**
 * A stacked column reserves more plot than other fill charts. Its columns (column.stacked and
 * column.stacked100) are 229 + 0.116 x width px
 * tall (mean of both; 340 at 960, 266 at 320), autoPlotPx + 80 px. Both sizing paths (the
 * floor search and the column content-fit certificate) read this one plotPx.
 */
export const STACKED_COLUMN_PLOT_PX = 80;
/**
 * On a canvas of NARROW_SHARE_WIDTH and wider, a stacked column (not 100%) reserves
 * 65 px. Its tallest stack is 300 px at 960 and 288 at 720, shorter than the
 * 100% columns (340, 330) that the shared mean also fits; the mean would be 25 px too tall at 960.
 * Its cards (276, 259, 240 px) match the mean and keep it.
 */
export const STACKED_COLUMN_WIDE_PLOT_PX = 65;
export function stackedColumnPlotPx(type: string, options: object | undefined, width?: number): number {
  const variant = (options as { variant?: string } | undefined)?.variant;
  if (type !== 'column' || (variant !== 'stacked' && variant !== 'stacked100')) return 0;
  return variant === 'stacked' && width !== undefined && width >= NARROW_SHARE_WIDTH ? STACKED_COLUMN_WIDE_PLOT_PX : STACKED_COLUMN_PLOT_PX;
}

/**
 * A 100% area reserves 40 px more plot. Its 0-100% band is
 * 310/280/250/240/240 px at 960-320; autoPlotPx alone gives 268/241/213 (-11 to -15%).
 */
export const AREA100_PLOT_PX = 40;
/**
 * An absolute variance reserves 45 px more plot from CARD_CLASS_WIDTH up. Its cards
 * are 491/472/459 px at 960/720/480; autoPlotPx alone gives 451/424/387 (-8 to -16%), and the bars
 * are the short part. Its narrow cards (448/408 at 400/320) already get 416 px without it.
 */
export const VARIANCE_ABSOLUTE_PLOT_PX = 45;

/**
 * Below NARROW_SHARE_WIDTH a relative variance and a unit Mekko reserve less plot.
 * Their cards need a shorter plot than autoPlotPx on a card: the relative variance's
 * value span is 174/154/152 px at 480/400/320 (autoPlotPx gives 196/186/186), and the unit Mekko
 * card is 426/424 px at 480/400 (autoPlotPx gives 467/467).
 */
export const VARIANCE_RELATIVE_NARROW_PLOT_PX = -25;
export const MEKKO_UNIT_NARROW_PLOT_PX = -40;

/**
 * A bridge without a value-axis break needs more plot.
 * The vertical bridge keeps about 280 px on cards and 335 px at 720/960;
 * PVM keeps about 260/280/305 px at 480/720/960. Horizontal rows grow toward
 * a 33/40/46 px pitch. The narrow card-height rule still applies.
 * Explicit breaks and the wide canvas keep their existing plot targets.
 */
function wholeBridgePlotPx(type: string, options: object | undefined, width: number | undefined): number {
  if ((type !== 'waterfall' && type !== 'pvm') || width === undefined || width >= WIDE_CANVAS_MIN_WIDTH) return 0;
  const bridge = options as { variant?: string; valueAxis?: { break?: unknown } } | undefined;
  if (bridge?.valueAxis?.break !== undefined && bridge.valueAxis.break !== false) return 0;
  if (type === 'pvm') return width < CARD_CLASS_WIDTH ? 20 : width < 720 ? 55 : 40;
  if (bridge?.variant === 'horizontal') return width < CARD_CLASS_WIDTH ? 0 : width < 720 ? 15 : width < 960 ? 40 : 60;
  return width < 400 ? 80 : width < 720 ? 72 : Math.max(73, 100 - (width - 720) * 27 / 240);
}

/** The plot an automatic height reserves on top of autoPlotPx for this type and variant (negative: less). */
export function typePlotPx(type: string, options: object | undefined, width?: number): number {
  if (type === 'waterfall' || type === 'pvm') return wholeBridgePlotPx(type, options, width);
  if (type === 'line' && (options as { variant?: string } | undefined)?.variant === 'stacked100-area') return AREA100_PLOT_PX;
  if (type === 'variance' && width !== undefined && width >= CARD_CLASS_WIDTH
    && ((options as { variant?: string } | undefined)?.variant ?? 'absolute') === 'absolute') {
    return VARIANCE_ABSOLUTE_PLOT_PX;
  }
  const narrow = width !== undefined && width < NARROW_SHARE_WIDTH;
  if (narrow && type === 'variance' && (options as { variant?: string } | undefined)?.variant === 'relative') {
    return VARIANCE_RELATIVE_NARROW_PLOT_PX;
  }
  if (narrow && type === 'mekko' && (options as { variant?: string } | undefined)?.variant === 'stacked') return MEKKO_UNIT_NARROW_PLOT_PX;
  return stackedColumnPlotPx(type, options, width);
}

export function resolveSizing(
  policy: ChartSizing,
  size: Size,
  measured: Partial<ResolvedSizing> = {},
): ResolvedSizing {
  policy = { ...policy, ...(measured.fit ? { fit: measured.fit, aspect: measured.aspect ?? policy.aspect } : {}) };
  const measuredMinWidth = ceilFloor(measured.measuredMinWidth ?? measured.minWidth ?? 0, size.width);
  const measuredMinHeight = ceilFloor(measured.measuredMinHeight ?? measured.minHeight ?? 0, size.height);
  const minWidth = ceilFloor(Math.max(policy.minWidth, measured.minWidth ?? 0), size.width);
  const minHeight = ceilFloor(Math.max(policy.minHeight, measured.minHeight ?? 0), size.height);
  return {
    ...policy,
    minWidth,
    minHeight,
    measuredMinWidth,
    measuredMinHeight,
    naturalWidth: ceilSizing(Math.max(minWidth, measured.naturalWidth ?? size.width)),
    naturalHeight: ceilSizing(Math.max(minHeight, measured.naturalHeight ?? aspectHeight(policy, size))),
    comfortableWidth: Math.ceil(minWidth * 1.25),
    comfortableHeight: Math.ceil(minHeight * 1.25),
    ...(measured.hint ? { hint: measured.hint } : {}),
  };
}

/** Arithmetic on measured tracks can leave an exact pixel a few ULPs above its integer. */
function ceilSizing(value: number): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <= Number.EPSILON * Math.max(1, Math.abs(value)) * 4
    ? nearest : Math.ceil(value);
}

/**
 * A floor in whole px, unless that whole px would refuse a received size the floor fits in. Some
 * layouts measure their floor at the received width (320.01 px), and 321 px would refuse it.
 */
function ceilFloor(value: number, received: number): number {
  const whole = ceilSizing(value);
  return value <= received && whole > received + SIZE_TOLERANCE ? received : whole;
}

/** Layouts supply their measured headers, footers, rows and existing tracks. */
export function rowSizing(type: string, size: Size, input: {
  chromeH: number;
  minimumRowsH: number;
  naturalRowsH: number;
  minWidth?: number;
  naturalWidth?: number;
  /** What forces the width, named in the size refusal. */
  hint?: string;
}): ResolvedSizing {
  // Layouts report content width. fitLayout adds the standalone canvas floor.
  return resolveSizing({ ...chartSizing(type), minWidth: 0 }, size, {
    minWidth: input.minWidth,
    minHeight: input.chromeH + input.minimumRowsH,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.chromeH + Math.max(input.minimumRowsH, input.naturalRowsH),
    ...(input.hint ? { hint: input.hint } : {}),
  });
}

/** Natural content bounds include the frame's measured surrounding text. */
export function contentSizing(type: string, size: Size, plot: Rect, rects: readonly Rect[], square = false): ResolvedSizing {
  const bounds = boundsOf(rects);
  const width = size.width - plot.w + bounds.w;
  const height = size.height - plot.h + bounds.h;
  return resolveSizing({ ...chartSizing(type), minWidth: 0 }, size, {
    naturalWidth: square ? Math.max(width, height) : width,
    naturalHeight: square ? Math.max(width, height) : height,
  });
}

/**
 * The band step a chart is comfortable at. Derived from the library's own
 * floors, not from taste: six categories on the registered 480px column
 * minimum get a 58px step, and `resolveSizing` already treats 1.25x a minimum
 * as comfortable.
 */
export const NATURAL_BAND_STEP = 72;

/**
 * Natural width for a chart whose categories sit on a band scale.
 * Bands stretch to whatever width the frame hands them, so an over-wide frame
 * produces over-wide columns and reserved gutters instead of clean free space.
 * This reports the canvas width at which the step reaches NATURAL_BAND_STEP,
 * so a host can shrink the frame. Laying out again at that width returns the
 * same number, which is why honouring it cannot turn into a width loop.
 */
export function bandSizing(type: string, size: Size, plotW: number, step: number, minPlotW?: number): ResolvedSizing {
  const naturalPlotW = step > 0 ? (plotW * NATURAL_BAND_STEP) / step : plotW;
  // The type's static floors are applied once, by the gate in fitLayout: a floor copied into
  // the layout's sizing would also be read as a measured one, and the compact fallback below
  // the minimum width could never apply. A layout that knows the narrowest plot its bands
  // read in (n × minSlot) reports it, and the chrome around the plot is added here.
  return resolveSizing({ ...chartSizing(type), minWidth: 0, minHeight: 0 }, size, {
    naturalWidth: size.width - plotW + naturalPlotW,
    ...(minPlotW !== undefined ? { minWidth: size.width - plotW + minPlotW } : {}),
  });
}

/**
 * Minimum tracks preserve header thinning; natural tracks show every heading
 * and every in-cell value (`cell`, the widest value's box).
 */
export function matrixWidths(chromeW: number, columns: number, gap: number, headers: readonly number[], cell = 0) {
  return {
    minWidth: chromeW + columns + (columns - 1) * gap + (headers[0] ?? 0) + (headers.at(-1) ?? 0),
    naturalWidth: chromeW + columns * Math.max(28, cell, maxOf(headers)) + (columns - 1) * gap,
  };
}

function requiredSize(size: Size, sizing: ChartSizing): Size {
  return { width: Math.max(size.width, sizing.minWidth), height: Math.max(size.height, sizing.minHeight) };
}

/** Whether a received size meets a type's minimum, within SIZE_TOLERANCE px on each axis. */
export function fitsSize(size: Size, sizing: Pick<ChartSizing, 'minWidth' | 'minHeight'>): boolean {
  return size.width + SIZE_TOLERANCE >= sizing.minWidth && size.height + SIZE_TOLERANCE >= sizing.minHeight;
}

export function sizeRefusal(type: string, title: string, size: Size, sizing: ResolvedSizing): RefusedLayout {
  // The frame the fix names: the floor where the request falls short, the
  // request where it does not. The suggestion names the same frame. A side that
  // fits keeps the received size, fraction included: the repair verified that frame.
  const fix = requiredSize(size, sizing);
  fix.width = size.width >= sizing.minWidth ? size.width : ceilSizing(fix.width);
  fix.height = size.height >= sizing.minHeight ? size.height : ceilSizing(fix.height);
  // A kept fractional side prints to 0.01 px, rounded up: the next whole px can be a wider class that refuses.
  const px = (value: number) => Number.isInteger(value) ? value : Math.ceil(value * 100 - 1e-6) / 100;
  const text = `${px(fix.width)} × ${px(fix.height)}px`;
  return {
    refused: true,
    type,
    title,
    size,
    sizing,
    warnings: [{
      code: 'size-below-floor',
      severity: 'error',
      message: `${title} needs at least ${text}; received ${+size.width.toFixed(2)} × ${+size.height.toFixed(2)}px`,
      suggest: `Render it at ${text} or larger.${sizing.hint ? ` ${sizing.hint}` : ''}`,
      field: ['options', 'size'],
      expected: { minimum: fix, inclusive: true },
      fix: [{
        op: 'replace',
        path: '/options/size',
        value: fix,
      }],
    }],
  };
}

/** Measurement can spend layouts to find a working size. Render keeps its estimate. */
export function verifiedSizeRepair(initial: Size, accepts: (size: Size) => boolean): { size?: Size; limit: Size } {
  const limit = { width: Math.ceil(initial.width * 4), height: Math.ceil(Math.max(initial.height * 4, initial.height + 4096)) };
  for (let width = initial.width; width <= limit.width; width *= 2) {
    let low = initial.height, height = initial.height;
    for (let pass = 0; pass < 8; pass++) {
      if (accepts({ width, height })) {
        while (height - low > 1) {
          const mid = Math.floor((low + height) / 2);
          if (accepts({ width, height: mid })) height = mid;
          else low = mid;
        }
        return { size: { width, height }, limit };
      }
      if (height === limit.height) break;
      low = height;
      height = Math.min(limit.height, Math.ceil(height * 2));
    }
  }
  return { limit };
}

/** Artifact paths fail before extracting claims or serializing a placeholder. */
export function requireGeometry<M extends object, D extends object>(result: LayoutResult<M, D>): Geometry<M, D> {
  if (result.refused) {
    const refusal = result.warnings[0]!;
    throw Object.assign(new NormalizeError(
      refusal.code, refusal.field?.join('.') ?? '', refusal.message, refusal.suggest, refusal.fix,
    ), { expected: refusal.expected });
  }
  return result;
}


/**
 * The floor a request is measured against: the definition's own, unless an
 * option moves it. `chartSizing` answers for a type and for the options it
 * was called with, and the two differ in two cases: a KPI card at
 * `density: 'compact'` stands 280 wide, a bullet 120. A definition that
 * brought a floor of its own keeps it everywhere else.
 */
export function declaredSizing<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>,
  options?: O,
): ChartSizing {
  let own = definition.sizing ?? chartSizing(definition.type);
  if (definition.type === 'bullet' && (options as { density?: unknown } | undefined)?.density === 'compact') own = { ...own, compactFloor: undefined };
  const minWidth = chartSizing(definition.type, options as { density?: unknown } | undefined).minWidth;
  // Density only changes the width floor; the declared height stays intact.
  return minWidth === chartSizing(definition.type).minWidth ? own : { ...own, minWidth };
}

/**
 * A slope's content height is the taller of its two
 * end-label stacks at the label pitch (the line box, never under 13 px, as
 * the slope spreads them), never less than the plot the same spec gets on
 * a 720 x 405 canvas, plus the frame around the plot. A label the
 * chart hid as redundant claims no room.
 */
function slopeContentHeight(geometry: Geometry<object, object>, plotAt720: number): number {
  const { plot, size, labels } = geometry;
  const stacks = [0, 0];
  for (const label of labels) {
    if (label.kind !== 'series' || label.hidden === 'redundant') continue;
    stacks[label.rect.x + label.rect.w / 2 < plot.x + plot.w / 2 ? 0 : 1]! += Math.max(label.rect.h, 13);
  }
  return Math.ceil(size.height - plot.h + Math.max(...stacks, plotAt720) - 1e-6);
}

/**
 * Refuse explicit undersizing; unsized charts can grow to their measured floor.
 *
 * a refusal's minimum is measured at the refused frame, in that
 * frame's width class, and a wider frame can pick a larger type class and so
 * a larger floor (a nine-column table refused at 1000 px measured 1314 px in
 * the middle class, then refused 1314 px for 1461 px in the large one). So a
 * refusal is laid out again at the frame its fix names, and the floor
 * measured there is reported, until laying out at the fix reports the same
 * floor. Refused probes only raise the floor; a lower floor is verified before
 * it is returned, so wrapping cannot produce an alternating repair pair.
 */
type SizeLayout<O extends ChartOptions, M extends object, DV extends object> =
  (options: O | undefined, compact: boolean) => LayoutResult<M, DV>;

export function fitLayout<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options?: O,
): LayoutResult<M, DV> {
  const run = prepareFitLayout(definition, data);
  try { return run(options); } finally { run.finish(); }
}

export type FitLayout<O extends ChartOptions, M extends object, DV extends object> =
  ((options?: O) => LayoutResult<M, DV>) & { finish(): void };

// Note passes in one registry call share the same fixed-frame minimum.
const mekkoHeightFloors = new WeakMap<object, Map<string, ResolvedSizing>>();

/** One stable frame-content variant, owned by one registry call. */
export function prepareFitLayout<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, origins = new WeakMap<object, object>(),
): FitLayout<O, M, DV> {
  const probes = new Map<string, LayoutResult<M, DV>>();
  const heightFloors = definition.type === 'mekko' ? mekkoHeightFloors.get(origins) ?? new Map<string, ResolvedSizing>() : undefined;
  if (heightFloors) mekkoHeightFloors.set(origins, heightFloors);
  const at: SizeLayout<O, M, DV> = (runOptions, compact) => {
    const size = runOptions?.size;
    const targetSize = (runOptions as TargetSizeOptions | undefined)?.[TARGET_SIZE];
    const fixed = targetSize?.fixed;
    const key = `${typeof size === 'object' ? `${size?.width}x${size?.height}:${size?.unit}` : String(size)}:${compact}:${forcedCompact(runOptions)}:${String(runOptions?.mode)}:${runOptions?.belowMinimum}:${fixed?.width}:${fixed?.height}:${targetSize?.sizePx.width}:${targetSize?.sizePx.height}:${isWidthProbe(definition.type, runOptions)}:${(runOptions as { [ACCEPTANCE_PROBE]?: boolean } | undefined)?.[ACCEPTANCE_PROBE]}`;
    let result = probes.get(key);
    if (result === undefined) {
      // Percent Mekko has no hanging totals: its frame minimum is constant at this width.
      const fixedMekko = definition.type === 'mekko' && ((runOptions as { variant?: string } | undefined)?.variant ?? 'stacked100') === 'stacked100';
      const requested = fixedMekko ? resolveSize(size, runOptions?.target) : undefined;
      const floorKey = fixedMekko ? JSON.stringify([requested!.width, compact, forcedCompact(runOptions),
        runOptions?.mode, runOptions?.belowMinimum, runOptions?.legend, frameTextOptions(runOptions ?? {})]) : '';
      const floor = fixedMekko ? heightFloors?.get(floorKey) : undefined;
      if (floor && (runOptions as { [FIXED_SIZE_PROBE]?: boolean })?.[FIXED_SIZE_PROBE]
        && requested!.height + SIZE_TOLERANCE < floor.minHeight) {
        return sizeRefusal(definition.type, definition.title, requested!, { ...floor });
      }
      result = fitSizeMemo(definition, data, runOptions, compact);
      if (fixedMekko && result.sizing && (result.refused ? plotChromeFloor.has(result) : plotChromeFloor.has(result.frame))) {
        heightFloors!.set(floorKey, result.sizing);
      }
      probes.set(key, result);
    }
    // fitAt changes naturalHeight, but must not change the fixed frame.
    const copy = { ...result, ...(result.sizing ? { sizing: { ...result.sizing } } : {}) };
    const floor = plotChromeFloor.get(result);
    if (floor !== undefined) plotChromeFloor.set(copy, floor);
    origins.set(copy, result);
    return copy;
  };
  const run = ((options?: O) => withLayoutMemo(() => {
    const inherited = (options as { [CARD_HEIGHT_MEMO]?: CardHeightMemo } | undefined)?.[CARD_HEIGHT_MEMO];
    const borrowed = inherited?.active && inherited.type === definition.type;
    const memo: CardHeightMemo = borrowed ? inherited : { type: definition.type, active: true, heights: new Map() };
    options = { ...options, [CARD_HEIGHT_MEMO]: memo } as unknown as O;
    try {
      // Complete wider-card dependencies before the height search starts. A wider
      // card warms its own dependency first, so fitOnce never re-enters itself.
      if (definition.type !== 'grid' && widthOnly(options.size) && declaredSizing(definition, options).fit === 'fill'
        && panelTypeClass(options) === undefined) {
        const width = resolveSize(options.size, options.target).width;
        if (width < CARD_CLASS_WIDTH) cardClassHeight(definition, data, options, width);
      }
      // Registry and legend passes change labels, warnings and scene nodes.
      // Give them their own result, while the fixed evaluator keeps its frame.
      const fitted = fitOrRepair(definition, data, options, at);
      const copy = copyLayout(fitted);
      origins.set(copy, origins.get(fitted) ?? fitted);
      if (!copy.refused) sourceFollowsContent(copy, options);
      return withPlotFloorWarning(copy, options, definition.title);
    } finally {
      if (!borrowed) { memo.active = false; memo.heights.clear(); memo.references = undefined; }
    }
  })) as FitLayout<O, M, DV>;
  run.finish = () => { probes.clear(); heightFloors?.clear(); };
  return run;
}

/** Copy fields the registry changes; retain immutable chart and theme payloads. */
function copyLayout<M extends object, DV extends object>(result: LayoutResult<M, DV>): LayoutResult<M, DV> {
  if (result.refused) return { ...result, sizing: { ...result.sizing }, warnings: [...result.warnings] };
  return {
    ...result,
    sizing: result.sizing ? { ...result.sizing } : undefined,
    warnings: [...result.warnings],
    frame: copyFrame(result.frame),
    a11y: { ...result.a11y, desc: singleStops(result.a11y.desc) },
    labels: result.labels.map(label => ({ ...label })),
    scene: result.scene.map(node => ({ ...node })),
  };
}

function fitOrRepair<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, atSize: SizeLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const first = fitAt(definition, data, options, atSize);
  if (!first.refused) {
    const grown = grownForNotes(definition, data, options, first, forcedCompact(options), atSize);
    return grownForFurniture(definition, data, options, grown, forcedCompact(options), atSize);
  }
  // A grid child already ran its repair search. Keep its non-size cause and advice.
  if (definition.type === 'grid' && first.warnings[0]?.code !== 'size-below-floor') return first;
  const received = first.size;
  const constraints = (options as TargetSizeOptions | undefined)?.[TARGET_SIZE]
    ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size);
  // A width search only needs to know that this width fails. Repair can raise this
  // floor, but cannot lower minWidth or unpin the received width. Keep the normal
  // path for accepted widths and for callers that need the refusal's repair size.
  if (isWidthProbe(definition.type, options) && constraints.fixed.width && !constraints.fixed.height
    && first.warnings[0]?.code === 'size-below-floor' && received.width < first.sizing!.minWidth) return first;
  // Keep attribution while it fits. Only a fixed compact frame can give it
  // up, and only after the full wrapped source and a single fitted line fail.
  // Each retry must pass the chart's own size checks, including plot reserves.
  const compact = options?.mode === 'compact' || belowMinimum(declaredSizing(definition, options), first.size, options, definition.type)
    || forcedCompact(options);
  const fixedFallback = options && (compact || definition.type === 'treemap' || definition.type === 'sankey') && options.belowMinimum !== 'refuse'
    && options.mode !== 'full'
    && panelTypeClass(options) === undefined && constraints.fixed.width && constraints.fixed.height;
  const warnHardMinimum = (fitted: Geometry<M, DV>): Geometry<M, DV> => {
    const target = options?.target ?? DEFAULT_TARGET;
    const height = Math.max(requiredSize(received, first.sizing!).height, plotFloorHeight(fitted, target));
    if (!fitted.warnings.some(warning => warning.code === 'plot-under-floor')) fitted.warnings.push({
      code: 'plot-under-floor', severity: 'warn',
      message: `the fixed height draws the plot under its floor, at the type's hard minimum; the chart needs ${height} px`,
      suggest: `Give the chart an estimated ${height} px of height, or leave the height out so the chart takes it. Use measure() for the exact verified size.`,
      field: ['options', 'size'],
      fix: [{ op: 'replace', path: '/options/size', value: { width: received.width, height } }],
    });
    return fitted;
  };
  // Keep the existing frame and its content before trying the optional footer
  // and subtitle steps. The comfortable plot and row air give way first.
  if (fixedFallback) {
    const fitted = fitAt(definition, data, { ...options, [HARD_MINIMUM]: true });
    if (!fitted.refused && namesDrawnSeries(data, fitted)) return warnHardMinimum(fitted);
  }
  // The source line stays under `footnotes: false` (footer rule), so the retry does too.
  const sourceStep = Boolean(!staticFrame.pinned && compact && options?.source
    && constraints.fixed.width && constraints.fixed.height);
  if (sourceStep && options) {
    for (const lines of [1, 0] as const) {
      const fitted = fitAt(definition, data, { ...options, [COMPACT_SOURCE_LINES]: lines });
      if (!fitted.refused) return fitted;
    }
  }
  // The last steps before a refusal in a fixed slot: the subtitle moves into the
  // notes list, then the type draws at its hard minimum (thinner bars) and names what it needs.
  if (fixedFallback) {
    const authored = options as ChartOptions & { subtitle?: BaseOptions['subtitle']; footnotes?: BaseOptions['footnotes'] };
    const subtitle = resolveSubtitle(authored.subtitle);
    // A chart with a unit keeps its subtitle: moved out, the unit line takes the same row
    // and the author's words give way to engine text. shortcut: also skips a unit printed on an
    // axis title; move the subtitle there too if a fixed slot needs that row.
    const line = subtitle && authored.footnotes !== false && !(authored as { unit?: string }).unit?.trim() ? subtitleLine(subtitle) : undefined;
    // This step runs after the source step, so the source stays with the host (`frame.source`): a source
    // line back on the canvas took the row the moved subtitle freed (the move gains 1 px).
    const footer = sourceStep ? { ...options, [COMPACT_SOURCE_LINES]: 0 } as O : options;
    const moved = line === undefined ? footer
      : { ...footer, subtitle: undefined, footnotes: [...(authored.footnotes || []), line], [MOVED_SUBTITLE]: line } as O;
    for (const hard of [false, true]) {
      if (!hard && line === undefined) continue;
      const fitted = fitAt(definition, data, hard ? { ...moved, [HARD_MINIMUM]: true } : moved);
      if (fitted.refused) continue;
      // The hard minimum is accepted only while every drawn series stays named.
      if (hard && !namesDrawnSeries(data, fitted)) continue;
      if (line !== undefined) fitted.warnings.push({
        code: 'subtitle-moved-to-notes', severity: 'warn',
        message: `the fixed height has no room for the subtitle, so it moved into the notes list: ${line}`,
        suggest: `Give the chart ${requiredSize(received, first.sizing!).height} px of height to keep the subtitle on the canvas.`,
        field: ['options', 'size'],
      });
      if (hard) return warnHardMinimum(fitted);
      return fitted;
    }
  }
  const automatic = !constraints.fixed.height;
  // A fixed search probe needs acceptance only, not a second search for repair advice.
  if ((!automatic || REPAIR_PROBE_TYPES.has(definition.type))
    && (options as { [FIXED_SIZE_PROBE]?: boolean } | undefined)?.[FIXED_SIZE_PROBE]) return first;
  // A chart that fell back to compact stays compact through the repair, so the refusal names
  // the size compact needs (the `belowMinimum: 'compact'` contract): a fixed 358 x 380 slot that
  // compact needs 876 px of height for names 358 x 876, not the full chart's 869 x 380.
  // A size under the declared floor runs compact anyway (`belowMinimum`), so the marker is set only
  // where it changes the layout: one cache key per frame, as before. An authored `mode: 'compact'`
  // is no fallback and repairs as it did.
  const holdsCompact = automatic ? forcedCompact(options)
    : forcedCompact(options) || (compact && options?.mode !== 'compact' && compactFallbackApplies(definition, options, data));
  const declared = declaredSizing(definition, options);
  const keepCompact = (size: Size) => holdsCompact && (automatic || fitsSize(size, declared));
  const at = (floor: ResolvedSizing) => {
    const size = requiredSize(received, floor);
    if (automatic) size.height = hostlessHeight({ ...floor, compactFloor: undefined }, size.width, size.height,
      panelTypeClass(options) === undefined);
    return fitOnce(definition, data, { ...options, size } as O, keepCompact(size), atSize);
  };
  let floor = first.sizing!;
  let next: LayoutResult<M, DV> = first;
  for (let pass = 0; pass < 8; pass++) {
    next = at(floor);
    if (!isRefused(next)) {
      // Pending card floors must keep the height measured at the repaired width.
      if (REPAIR_PROBE_TYPES.has(definition.type)) floor = resolveSizing(floor, received, {
        ...floor,
        minWidth: Math.max(floor.minWidth, next.sizing!.minWidth),
        minHeight: Math.max(floor.minHeight, next.sizing!.minHeight),
      });
      // Acceptance proves this repair fits, not that its canvas or content
      // bounds are a minimum. Only a changed fit policy supplies a new natural
      // height (for example, a grid containing only content-fit children).
      if (next.sizing!.fit !== floor.fit) floor = { ...floor,
        fit: next.sizing!.fit, aspect: next.sizing!.aspect, naturalHeight: next.sizing!.naturalHeight };
      // A wider frame can wrap less. Lower that floor only when the smaller
      // pair also renders; otherwise keep the pair this probe verified.
      if (next.sizing!.minHeight < floor.minHeight) {
        const smaller = { ...floor, minHeight: next.sizing!.minHeight };
        const lower = at(smaller);
        if (!isRefused(lower)) { floor = smaller; next = lower; }
      }
      break;
    }
    const raised = resolveSizing(floor, received, next.sizing);
    if (raised.minWidth === floor.minWidth && raised.minHeight === floor.minHeight) break;
    floor = raised;
  }
  // A side the caller left open is the chart's to choose, so
  // the chart takes its floor there instead of refusing.
  if (!constraints.fixed.width || (automatic && floor.minWidth <= received.width)) {
    // the repair kept the height measured at the refused width. An
    // automatic content height is measured again at the repaired width.
    if (!isRefused(next) && automatic && next.sizing?.fit === 'content' && next.sizing.naturalHeight !== next.size.height) {
      const natural = fitOnce(definition, data, { ...options, size: { width: next.size.width } } as O, holdsCompact && automatic, atSize);
      if (!isRefused(natural)) return natural;
    }
    if (!isRefused(next)) return next;
  }
  if (REPAIR_PROBE_TYPES.has(definition.type) && floor.minWidth > received.width) {
    // A width repair must draw after the host pins both sides, including its notes.
    for (let pass = 0; pass < 3; pass++) {
      const pinned = getChart(definition.type)?.layout(data, { ...withoutForcedCompact(options),
        size: requiredSize(received, floor), [FIXED_SIZE_PROBE]: true,
      });
      if (!pinned || !isRefused(pinned) || !pinned.sizing) break;
      const raised = resolveSizing(floor, received, pinned.sizing);
      if (raised.minWidth === floor.minWidth && raised.minHeight === floor.minHeight) break;
      floor = raised;
    }
  }
  if (definition.type !== 'table') return sizeRefusal(definition.type, definition.title, received, floor);
  // An alternative such as wrapping must work at the received size. A repair
  // probe at a larger size cannot add an alternative to the original refusal.
  const { hint: _repairHint, ...repairFloor } = floor;
  return sizeRefusal(definition.type, definition.title, received, {
    ...repairFloor, ...(first.sizing?.hint ? { hint: first.sizing.hint } : {}),
  });
}

/**
 * A fixed height never grows. When the drop order (docs/manual.md, "Fixed
 * height") still leaves the plot under its floor, the chart is drawn and says which height
 * gives the plot its floor. A refusal keeps its own finding.
 */
function withPlotFloorWarning<M extends object, DV extends object>(result: LayoutResult<M, DV>, options: ChartOptions | undefined, title: string): LayoutResult<M, DV> {
  const target: RenderTarget = options?.target ?? DEFAULT_TARGET;
  if (isRefused(result)) {
    result.warnings = result.warnings.filter(warning => warning.code !== 'plot-under-floor');
    return result;
  }
  if (result.refused || heightOmitted(options?.size) || panelTypeClass(options) !== undefined
    || result.sizing?.fit !== 'fill') return result;
  const plot = plotForFloor(result);
  // The hard-minimum step already names the height the chart needs.
  if (plot.h + SIZE_TOLERANCE >= PLOT_FLOOR_PX[target] || result.warnings.some((warning) => warning.code === 'plot-under-floor')) return result;
  const height = plotFloorHeight(result, target);
  // Notes the author opted into (notes.show 'disclosure') never take the plot under its floor:
  // the chart refuses with the height that seats both.
  if (result.sizing && rankKeyShown(options) && result.frame.noteList?.some((note) => note.kind === 'disclosure' && note.inFrame)) {
    return sizeRefusal(result.type, title, result.size, { ...result.sizing, minHeight: height, measuredMinHeight: Math.min(result.sizing.measuredMinHeight, height) });
  }
  result.warnings.push({
    code: 'plot-under-floor',
    severity: 'warn',
    message: `the fixed height leaves the plot ${Math.round(plot.h)} px, under its ${PLOT_FLOOR_PX[target]} px floor on the ${target} target; the chart needs ${height} px`,
    suggest: `Give the chart ${height} px of height, or leave the height out so the chart takes it.`,
    field: ['options', 'size'],
    fix: [{ op: 'replace', path: '/options/size', value: { width: result.size.width, height } }],
  });
  return result;
}

/**
 * a label drawn on the chart beats a label listed in a note. When the host left the
 * height open and the first layout names labels in its note, the chart tries the next taller
 * height steps of the standard ladder (std, a4, tall at its width) and takes the first at which
 * no label is left to the note. When no step does, more height does not help and the first
 * layout stands, note and all. A pinned height always stands: the note is
 * the way out there.
 */
/** The most an automatic card height grows past its floor so that no label goes to the note. */
export const NOTE_GROWTH_SHARE = 0.25;

function grownForNotes<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, first: LayoutResult<M, DV>, compact = false,
  atSize?: SizeLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const constraints = (options as TargetSizeOptions | undefined)?.[TARGET_SIZE]
    ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size);
  const owes = (layout: LayoutResult<M, DV>) => !layout.refused && layout.labels.some(notedForSize);
  if (constraints.fixed.height || panelTypeClass(options) !== undefined || !owes(first)) return first;
  const width = first.size.width;
  // The grown height is the chart's natural height, as grownForFurniture records it: `measure` then names the height that draws.
  const at = (height: number) => {
    const layout = fitOnce(definition, data, { ...options, size: { width, height } } as O, compact, atSize);
    if (!layout.refused && layout.sizing && widthOnly(options?.size)) {
      layout.sizing = { ...layout.sizing, naturalHeight: Math.max(layout.sizing.naturalHeight, layout.size.height) };
    }
    return layout;
  };
  // A taller step is laid out at a fixed height, so its frame can take the plot under the floor
  // the automatic height kept (combo.order-value-threshold-corridor at 320: 37% plot). Such a step
  // does not count as a way out of the note; the plot floor holds first.
  const target = options!.target!;
  const share = autoPlotShare(definition, options, width);
  const fill = declaredSizing(definition, options).fit !== 'content' && definition.type !== 'grid';
  const short = (layout: LayoutResult<M, DV>) => fill && !layout.refused
    && plotFloorHeight(layout, target, PLOT_FLOOR_PX[target], share, freedChromeOf(layout.frame)) > layout.size.height + SIZE_TOLERANCE;
  const ladder = ladderHeights(width).map((step) => step.height)
    .filter((height) => height > first.size.height * (1 + LADDER_TOLERANCE));
  // On a card the content floor is often above every ladder step (the
  // 'tall' step at 480 px is 361 px), so the search had no step to try and a value stayed in the
  // note (column.stacked100 at 480 px). Below the wide class it may also grow by up to a quarter.
  const steps = width >= WIDE_CANVAS_MIN_WIDTH || ladder.length > 0 ? ladder
    : [Math.ceil(first.size.height * (1 + NOTE_GROWTH_SHARE))];
  let below = first.size.height;
  let top: LayoutResult<M, DV> | undefined;
  for (const height of steps) {
    const next = at(height);
    if (!next.refused) top = next;
    if (next.refused || owes(next) || short(next)) { below = height; continue; }
    // Below the wide class the chart takes the smallest whole-px height
    // between the last step that still owes a note and this one, not the ladder step itself.
    if (width >= WIDE_CANVAS_MIN_WIDTH) return next;
    let best = next;
    let low = below;
    let high = height;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      const probe = at(mid);
      if (probe.refused || owes(probe) || short(probe)) low = mid;
      else { best = probe; high = mid; }
    }
    return best;
  }
  // A note that never empties (values no height can seat) still should
  // not take a value a little more height would seat. Below the wide class the chart takes the
  // smallest height that notes no more labels than the tallest height tried, when that notes fewer.
  // (A goal of one fewer than the first layout depends on how short the first was: a smaller key
  // there noted one more and stopped the search at a height that still noted a label the top seats.)
  const noted = (layout: LayoutResult<M, DV>) => layout.refused ? Infinity : layout.labels.filter(notedForSize).length;
  if (width >= WIDE_CANVAS_MIN_WIDTH || top === undefined || noted(top) >= noted(first) || short(top)) return first;
  const goal = noted(top);
  let best = top;
  let low = first.size.height;
  let high = top.size.height;
  // The exact lowest height (a rare path: only a note no height empties): the count can fall at
  // one exact height, which a 2 px stop would miss by a pixel.
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const probe = at(mid);
    if (noted(probe) > goal || short(probe)) low = mid;
    else { best = probe; high = mid; }
  }
  return best;
}

/** The share of the canvas height outside the frame's plot band, with the axis-label row counted in. */
export function furnitureShare<M extends object, DV extends object>(geo: Geometry<M, DV>): number {
  const tickBand = (geo.derived as { tickBand?: { reserved?: number } } | undefined)?.tickBand;
  return (geo.size.height - (geo.frame.plotRect ?? geo.plot).h + (tickBand?.reserved ?? 0)) / geo.size.height;
}

/** Grace on the furniture budget: the space lint's ratio grace. */
const FURNITURE_EPS = 0.002;

/**
 * An automatic height keeps the furniture budget when a taller height inside the size ladder
 * does. The chart takes the smallest such height (the smallest such step from the wide class
 * up). Above the tallest step the first layout stands and the space lint names the cost.
 */
function grownForFurniture<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, first: LayoutResult<M, DV>, compact = false,
  atSize?: SizeLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const constraints = (options as TargetSizeOptions | undefined)?.[TARGET_SIZE]
    ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size);
  if (first.refused) return first;
  if (constraints.fixed.height || panelTypeClass(options) !== undefined || definition.type === 'grid'
    || contentSized(definition.type, options, declaredSizing(definition, options).fit)) return first;
  const cls = aspectClassFor(definition.type, options as Record<string, unknown> | undefined, first.marks);
  if (!cls || !furnitureScoped(cls, first.size)) return first;
  const width = first.size.width;
  const budget = furnitureBudget(width);
  // A taller height must not send a label to the note that the first layout drew.
  const noted = first.labels.some(notedForSize);
  const over = (layout: LayoutResult<M, DV>) => layout.refused || (!noted && layout.labels.some(notedForSize))
    || furnitureShare(layout) > budget + FURNITURE_EPS;
  if (!over(first)) return first;
  // The grown height is the chart's natural height, as fitAt records for the first layout.
  const at = (height: number) => {
    const layout = fitOnce(definition, data, { ...options, size: { width, height } } as O, compact, atSize);
    if (!layout.refused && layout.sizing && widthOnly(options?.size)) {
      layout.sizing = { ...layout.sizing, naturalHeight: Math.max(layout.sizing.naturalHeight, layout.size.height) };
    }
    return layout;
  };
  const steps = ladderHeights(width).map((step) => step.height).filter((height) => height > first.size.height).sort((a, b) => a - b);
  const top = steps.at(-1);
  // The furniture does not shrink on a taller canvas, so the height it needs is at least
  // furniture / budget. Above the tallest step no ladder height keeps the budget: no layout to try.
  if (top === undefined || Math.ceil(furnitureShare(first) * first.size.height / budget) > top) return first;
  if (width >= WIDE_CANVAS_MIN_WIDTH) {
    for (const height of steps) {
      const next = at(height);
      if (!over(next)) return next;
    }
    return first;
  }
  // The frame's furniture changes little with the height, so the height it needs is close to
  // furniture / budget. Each retry starts from the furniture the last height measured.
  let height = first.size.height;
  let furniture = furnitureShare(first) * height;
  for (let attempt = 0; attempt < 3; attempt++) {
    height = Math.min(top, Math.max(height + 1, Math.ceil(furniture / budget)));
    const layout = at(height);
    if (!over(layout)) return layout;
    if (layout.refused || height === top) return first;
    furniture = furnitureShare(layout) * height;
  }
  return first;
}

/**
 * Set by the last fixed-slot step: the type draws at its hard minimum instead of
 * its comfortable one. A bar's rows then hold their category text but not each segment label.
 */
export const HARD_MINIMUM = Symbol('boardplot.hardMinimum');

/** Set by the registry's outermost layout call: draw compact, because full mode lacked room on a pinned canvas. */
/** A prepared runner belongs to one layout or measure call. */
export const LAYOUT_CALL = Symbol('boardplot.layoutCall');
export const FULL_LAYOUT_PROBE = Symbol('boardplot.fullLayoutProbe');
/** Only explicit measurement may spend layouts to verify repair advice. */
export const VERIFY_ADVICE = Symbol('boardplot.verifyAdvice');
export type LayoutCall<O extends ChartOptions = ChartOptions, M extends object = object, DV extends object = object>
  = ((options?: O) => LayoutResult<M, DV>) & { finish(): void; accepts(data: unknown, options?: O): boolean; probe(options?: O): LayoutResult<M, DV> };

export const FORCE_COMPACT = Symbol('boardplot.forceCompact');

/** The owning chart's width-only search; its rejected probes do not need repair advice. */
export const WIDTH_PROBE = Symbol('boardplot.widthProbe');
export const FIXED_SIZE_PROBE = Symbol('boardplot.fixedSizeProbe');
/** Set by a probe that reads only whether the chart draws (`isRefused`): it skips work that only words a warning. */
export const ACCEPTANCE_PROBE = Symbol('boardplot.acceptanceProbe');

export function isWidthProbe(type: string, options: ChartOptions | undefined): boolean {
  return (options as { [WIDTH_PROBE]?: string } | undefined)?.[WIDTH_PROBE] === type
    && options?.belowMinimum === 'refuse' && panelTypeClass(options) === undefined;
}

function forcedCompact(options: unknown): boolean {
  return (options as { [FORCE_COMPACT]?: boolean } | undefined)?.[FORCE_COMPACT] === true;
}

/**
 * Options without the FORCE_COMPACT marker. The registry's size probes ask the chart what it needs
 * at another size and must not inherit the marker of the call that made them: a probe that drew
 * compact would hide that the full chart lacks room there.
 */
export function withoutForcedCompact<T>(options: T): T {
  if (options === null || typeof options !== 'object' || !(FORCE_COMPACT in options)) return options;
  const { [FORCE_COMPACT]: _forced, ...rest } = options as Record<symbol, unknown>;
  return rest as T;
}

/**
 * A chart on a canvas its host pinned draws at that size or says what it needs.
 * Full mode that lacks room falls back to compact for the types with a compact
 * floor (`compactFallbackApplies`; the registry makes the second call), so a canvas
 * at the minimum never shows a blank box where a canvas just below it shows a chart.
 * Only when compact does not fit either is the chart refused, and the refusal names
 * the size compact needs. `belowMinimum: 'refuse'` keeps the full-mode refusal. A
 * canvas the chart sizes itself (no size, or a width alone) grows to its full floor.
 */
function fitAt<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options?: O, atSize?: SizeLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const result = fitOnce(definition, data, options, forcedCompact(options), atSize);
  // The plot floor can grow an automatic height past the aspect height; the height the chart takes is its natural height.
  if (widthOnly(options?.size) && !result.refused && result.sizing) {
    result.sizing.naturalHeight = Math.max(result.sizing.naturalHeight, result.size.height);
  }
  return result;
}

/**
 * Whether a full-mode size refusal falls back to compact: a pinned canvas (an authored size, or the
 * fixed default canvas of the slide and print targets), a type with a compact floor, no
 * `belowMinimum: 'refuse'`. A pinned width alone counts too: full runs first, and with the height left to the chart its size refusal can only be on width.
 */
export function compactFallbackApplies<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, options?: O, data?: D,
): boolean {
  return declaredSizing(definition, options).compactFloor !== undefined && options?.belowMinimum !== 'refuse'
    && ((options as TargetSizeOptions | undefined)?.[TARGET_SIZE] ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size)).fixed.width
    && panelTypeClass(options) === undefined && definition.type !== 'mekko' && options?.mode !== 'full'
    && (data === undefined || definition.compactForm?.(data, options) !== false);
}

/**
 * A full refusal of a FALLBACK_COMPACT type that the registry's layoutFitted replaces with the
 * compact form at the same size: its drawing, or its own size refusal. A repair search for the
 * full refusal is then lost work.
 */
export function compactReplacesRefusal<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, options: O | undefined, data: D,
): boolean {
  if (!FALLBACK_COMPACT.has(definition.type) || forcedCompact(options) || !compactFallbackApplies(definition, options, data)) return false;
  const requested = (options as TargetSizeOptions | undefined)?.[TARGET_SIZE]
    ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size);
  return !(requested.fixed.height && !fitsSize(requested.sizePx, declaredSizing(definition, options)));
}

/** Shared only by the owning top-level call and its wider-card probes. */
export const CARD_HEIGHT_MEMO = Symbol('boardplot.cardHeightMemo');
export interface CardHeightMemo {
  type: string;
  active: boolean;
  heights: Map<string, number | undefined>;
  references?: { data: unknown; options: ChartOptions; height: number | undefined; restore?: () => void }[];
}

/** A chart-owned wider-card request shares the current call's dependency results. */
export function cardReferenceHeight<D, O extends ChartOptions>(data: D, options: O, wider: O,
  draw: (options: O) => LayoutResult, capture?: () => () => void,
): number | undefined {
  const memo = (options as O & { [CARD_HEIGHT_MEMO]?: CardHeightMemo })[CARD_HEIGHT_MEMO];
  if (!memo?.active) {
    const result = draw(wider);
    return result.refused ? undefined : result.size.height;
  }
  const same = (a: unknown, b: unknown) => a === b || Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((item, i) => item === b[i]);
  const entries = memo.references ??= [];
  const match = entries.find(entry => entry.data === data
    && resolveSize(entry.options.size, entry.options.target).width === resolveSize(wider.size, wider.target).width
    && [...new Set([...Object.keys(entry.options), ...Object.keys(wider)])].every(key => key === 'size'
      || same((entry.options as Record<string, unknown>)[key], (wider as Record<string, unknown>)[key])));
  if (match) { match.restore?.(); return match.height; }
  const result = draw({ ...wider, [CARD_HEIGHT_MEMO]: memo });
  const height = result.refused ? undefined : result.size.height;
  entries.push({ data, options: wider, height, restore: capture?.() });
  return height;
}

/**
 * The height the chart takes at the next wider card step (400, then CARD_CLASS_WIDTH) through
 * the registered layout, which applies the same rule there, so 320 >= 400 >= 480. Its key, unit
 * line and hidden-label note pass included. A probe of this layout alone missed the note the
 * wider card prints and so drew the narrower card shorter.
 * The options lose the engine's internal markers and the note a narrower pass composed, so the
 * wider card is laid out as its host would request it. The owning call can reuse a wider
 * step; the memo is cleared at its exit and never uses data or theme as a key.
 */
function cardClassHeight<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O, width: number, cachedOnly = false,
): number | undefined {
  const own = options as O & { authoredFootnotes?: string[]; footnotesOff?: boolean };
  const raw: Record<string, unknown> = Object.fromEntries(Object.entries(own)
    .filter(([key]) => key !== 'authoredFootnotes' && key !== 'footnotesOff'));
  raw.footnotes = own.footnotesOff ? false : own.authoredFootnotes ?? own.footnotes;
  raw.size = { width: CARD_STEPS.find((step) => step > width)! };
  // The key policy hands the layout `legend: undefined` for an authored 'auto', and its probe pins a
  // top key and the narrower card's mode. The host asked for the automatic key either way.
  if (AUTO_LEGEND in own) delete raw.mode;
  if (AUTO_LEGEND in own || ('legend' in raw && raw.legend === undefined)) raw.legend = 'auto';
  const scope = (options as { [CARD_HEIGHT_MEMO]?: CardHeightMemo })[CARD_HEIGHT_MEMO];
  const memo = scope?.active && scope.type === definition.type ? scope : undefined;
  // JSON, not String(): an authored legend is an object, often without a prototype.
  const key = JSON.stringify([(raw.size as { width: number }).width, raw.mode, raw.legend, raw.belowMinimum]);
  if (cachedOnly) return memo?.heights.get(key);
  if (memo?.heights.has(key)) return memo.heights.get(key);
  const layout = getChart(definition.type)?.layout ?? ((d: D, o: O) => fitLayout(definition, d, o));
  if (memo) (raw as Record<symbol, unknown>)[CARD_HEIGHT_MEMO] = memo;
  let height: number | undefined;
  try {
    const wider = layout(data, raw as O);
    height = isRefused(wider) ? undefined : wider.size.height;
  } catch (error) {
    if (!(error instanceof NormalizeError)) throw error;
  }
  memo?.heights.set(key, height);
  return height;
}

function fitOnce<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, compactFallback: boolean, atSize?: SizeLayout<O, M, DV>,
): LayoutResult<M, DV> {
  const declared = declaredSizing(definition, options);
  // a width alone takes the chart's own height at that width: a fill
  // chart its aspect height, a content-fit chart the height its content needs
  // there, measured on a first pass at the aspect height.
  if (widthOnly(options?.size)) {
    const at = (width: number, height: number) => {
      const fixed = { ...options, size: { width, height } } as O;
      return atSize ? atSize(fixed, compactFallback) : fitSizeMemo(definition, data, fixed, compactFallback);
    };
    const width = resolveSize(options.size, options.target).width;
    const target: RenderTarget = options.target ?? DEFAULT_TARGET;
    const nested = panelTypeClass(options) !== undefined;
    let height = hostlessHeight(declared, width, resolveSize(options.size, options.target).height, !nested);
    // a natural height measured on a frame of another height can
    // change at its own height (a squashed probe wraps or moves a block), so
    // the chart is laid out again until it is drawn at the natural
    // height it reports there.
    if (declared.fit === 'content' || definition.type === 'grid') {
      let settled = contentHeight();
      // A grid of fill panels keeps the plot floor checked by the layout scorecard: its
      // canvas grows until the plot holds it, while the plot takes the added height.
      if (definition.type === 'grid' && !nested) {
        const share = autoPlotShare(definition, options, width);
        for (let pass = 0; pass < 3 && !settled.refused; pass++) {
          const need = plotFloorHeight(settled, target, PLOT_FLOOR_PX[target], share, freedChromeOf(settled.frame));
          if (need <= settled.size.height + SIZE_TOLERANCE) break;
          const tall = at(width, need);
          if (tall.refused || plotForFloor(tall).h <= plotForFloor(settled).h + SIZE_TOLERANCE) break;
          settled = tall;
        }
      }
      // Content height floor: a card is never shorter than the
      // next wider card step. Types whose marks scale with the width keep their own height.
      // Only the types whose content can get shorter at a narrower card pay for the wider probe
      // (rows of other content types wrap taller); the scorecard checks every type.
      if (nested || width >= CARD_CLASS_WIDTH || settled.refused || !CARD_FLOOR_CONTENT_TYPES.has(definition.type)) return settled;
      const wider = cardClassHeight(definition, data, options, width);
      if (wider === undefined || settled.size.height + SIZE_TOLERANCE >= wider) return settled;
      const tall = at(width, wider);
      return tall.refused ? settled : tall;
    }
    function contentHeight(): LayoutResult<M, DV> {
      for (let pass = 0; pass < 4; pass++) {
        const probe = at(width, height);
        const natural = probe.sizing?.naturalHeight;
        // Tables can resize their frame around measured rows without replaying the ladder.
        if (natural === height || ((definition.type === 'table' || definition.type === 'dimswitch')
          && !probe.refused && probe.size.height === natural)
          || (definition.type === 'pie' && !probe.refused && settledAutoHeight.has(probe.frame) && probe.size.height === natural)) return probe;
        if (natural === undefined) break;
        height = natural;
        // A grid of fill panels reports a canvas height, not a content height.
        if (probe.sizing?.fit !== 'content') break;
      }
      return at(width, height);
    }
    if (!nested) {
      // A scatter keeps its 4:3 start and the plain floor: its plot is a square-ish field, not a strip.
      // A scatter keeps 0.5 too: its field needs more height on cards. A waterfall keeps
      // 0.5: at 0.4 the ebit bridge at 320 px would move its B2C value into the note (every value is labelled).
      const plotShare = autoPlotShare(definition, options, width);
      // The share every layout keeps; a chosen larger share (PLOT_SHARE) is a goal, not a floor.
      const floorShare = autoPlotShare(definition, { ...options, [PLOT_SHARE]: undefined }, width);
      // Header and footer room a spacing rule freed counts as frame here, so the
      // plot takes it and the canvas does not get shorter because of it (frame.ts recordFreedChrome).
      const freed = (r: LayoutResult<M, DV>) => r.refused ? 0 : freedChromeOf(r.frame);
      // Height floor: a narrower canvas is never shorter than a wider one. A card (narrower than
      // CARD_CLASS_WIDTH) starts at the height the chart takes at the next wider card step, full or compact.
      if (width < CARD_CLASS_WIDTH) height = Math.max(height, cardClassHeight(definition, data, options, width, true) ?? 0);
      // A bridge asked for an 'auto' break that finds none is a whole-axis bridge, so it keeps that plot allowance.
      // The probe is the search's own first layout (same start height), so the layout memo serves the search; it runs
      // only where a whole-bridge allowance exists.
      const wholeAxis = { ...options, valueAxis: { ...(options as { valueAxis?: object }).valueAxis, break: false } };
      const drawnProbe = declared.aspect === '16:9' && (options as { valueAxis?: { break?: unknown } } | undefined)?.valueAxis?.break === 'auto'
        && wholeBridgePlotPx(definition.type, wholeAxis, width) !== 0 ? at(width, height) : undefined;
      const allowanceOptions = drawnProbe && !drawnProbe.refused && !drawnProbe.axes.some((axis) => axis.break)
        && !drawnProbe.scene.some((node) => node.t === 'line' && (node.part === 'barBreak' || node.part === 'axisBreak'))
        ? wholeAxis : options;
      const plotPx = declared.aspect === '16:9' ? autoPlotPx(target, width) + typePlotPx(definition.type, allowanceOptions, width) : PLOT_FLOOR_PX[target];
      // The search runs as a function of the plot floor, so a stacked column can try its
      // wide floor first and keep the plain one when that hides fewer values.
      const search = (plotPx: number, startHeight: number): LayoutResult<M, DV> => {
        let height = startHeight;
        // Grow the canvas until the plot keeps its floor. A chart whose plot does not take
        // the added height (variance tiers are rows) keeps the smaller canvas.
        let previous: LayoutResult<M, DV> | undefined;
        let directRefusal: { height: number; pass: number } | undefined;
        let triedDirectRefusal = false;
        // A frame part that scales with the plot (a scatter size key draws its
        // rings at plot scale) moves the floor height with each pass, so the
        // passes close in on it over more steps than four.
        for (let pass = 0; pass < 8; pass++) {
          const probe = at(width, height);
          if (directRefusal) {
            const chrome = probe.refused ? Infinity : probe.size.height - plotForFloor(probe).h + freed(probe);
            const floor = Math.ceil(Math.max(chrome + plotPx, chrome / (1 - plotShare)) - 1e-6);
            if (probe.refused || floor !== height) {
              // A note can disappear at the taller frame. Resume the original growth path.
              height = directRefusal.height;
              pass = directRefusal.pass;
              directRefusal = undefined;
              continue;
            }
            directRefusal = undefined;
          }
          // A frame taller than the start height first takes the height it measured.
          const short = probe.refused && probe.size.width + SIZE_TOLERANCE >= (probe.sizing?.minWidth ?? Infinity) ? probe.sizing!.minHeight : 0;
          if (short > height) {
            const chrome = pass < 7 && !triedDirectRefusal && ['mekko', 'column', 'histogram'].includes(definition.type) ? plotChromeFloor.get(probe) : undefined; // a refusal frees nothing
            const candidateHeight = chrome === undefined ? short : Math.max(short,
              Math.ceil(Math.max(chrome + plotPx, chrome / (1 - plotShare)) - 1e-6));
            if (candidateHeight > short) {
              directRefusal = { height: short, pass };
              triedDirectRefusal = true;
            }
            height = candidateHeight;
            continue;
          }
          if (probe.refused) break;
          // The plot's part of each added px. Under half keeps the smaller canvas, unless that canvas
          // misses the share floor and the plot still grows (a rotated category row takes the rest, in steps).
          const gain = previous && !previous.refused ? (plotForFloor(probe).h - plotForFloor(previous).h) / (probe.size.height - previous.size.height) : undefined;
          const underShare = previous !== undefined && !previous.refused && plotForFloor(previous).h + 1e-6 < floorShare * previous.size.height;
          // A smaller canvas whose frame part gave way is no canvas to keep.
          if (gain !== undefined && gain < 0.5 && !(gain > 0 && underShare) && partNeedOf((previous as { frame?: Geometry['frame'] }).frame) <= previous!.size.height) return previous!;
          const { need, holds } = autoHeightNeed(probe, target, plotPx, plotShare, freed(probe));
          if (holds || (settledAutoHeight.has(probe.frame) && need <= probe.size.height)) return probe;
          if (need <= height && previous === undefined) return probe;
          if (need <= height) {
            if (probe.size.height - previous!.size.height <= 1) return probe;
            // The chart certified a lower bound for every height in the interval.
            // No smaller frame can hold the plot floor below this bound.
            const certified = plotChromeFloor.get(probe.frame) === undefined ? undefined : plotChromeFloor.get(probe.frame)! + freed(probe);
            if (certified !== undefined && Math.ceil(Math.max(certified + plotPx, certified / (1 - plotShare)) - 1e-6) === height) return probe;
            const chrome = probe.size.height - plotForFloor(probe).h + freed(probe);
            const floor = Math.ceil(Math.max(chrome + plotPx, chrome / (1 - plotShare)) - 1e-6);
            const candidateHeight = Math.max(previous!.size.height + 1, floor);
            // shortcut: these frames change with plot height (CAGR headers, scatter size keys
            // and zone labels); retain the search until a stable bound exists.
            const dynamicFrame = ((definition.type === 'waterfall' || definition.type === 'pvm')
              && options.annotations?.some(annotation => annotation.kind === 'cagr'))
              || definition.type === 'scatter';
            const candidate = candidateHeight === height || dynamicFrame ? probe : at(width, candidateHeight);
            if (!dynamicFrame && !candidate.refused && autoHeightNeed(candidate, target, plotPx, plotShare, freed(candidate)).need <= candidateHeight) {
              const candidateChrome = candidate.size.height - plotForFloor(candidate).h + freed(candidate);
              const checkedFloor = Math.ceil(Math.max(candidateChrome + plotPx, candidateChrome / (1 - plotShare)) - 1e-6);
              if (candidateHeight === previous!.size.height + 1 || checkedFloor === candidateHeight) return candidate;
            }
            // `need` assumed the shorter frame's lines (a note naming the labels its small plot hid),
            // which the taller frame drops. Search back down to the lowest height that keeps the floor.
            let low = previous!.size.height;
            let best = probe;
            // Stop within 2 px of the lowest height; one pass less per search.
            while (best.size.height - low > 2) {
              const mid = Math.floor((low + best.size.height) / 2);
              const between = at(width, mid);
              if (!between.refused && autoHeightNeed(between, target, plotPx, plotShare, freed(between)).need <= mid) best = between; else low = mid;
            }
            return best;
          }
          previous = probe;
          // Mekko solves its hanging-total reserve at the minimum plot height.
          const certifiedChrome = ['mekko', 'column', 'histogram'].includes(definition.type) ? plotChromeFloor.get(probe.frame) : undefined;
          const chrome = certifiedChrome === undefined ? undefined : certifiedChrome + freed(probe);
          const floor = chrome === undefined ? need : Math.ceil(Math.max(chrome + plotPx, chrome / (1 - plotShare)) - 1e-6);
          height = floor > height ? floor : need;
        }
        return at(width, height);
      };
      const first = search(plotPx, height);
      const plainPx = declared.aspect === '16:9' ? autoPlotPx(target, width) + typePlotPx(definition.type, options) : plotPx;
      if (plainPx === plotPx || hiddenForSpace(first) === 0) return first;
      const plain = search(plainPx, height);
      if (hiddenForSpace(plain) >= hiddenForSpace(first)) return first;
      // A smaller plot target can hide a label the plain one seats. Take the lowest height
      // between the two that hides no more than the plain one (unit Mekko at 480: its average
      // label needs 438 px, the plain target draws 467, the smaller one 426).
      if (plain.refused || first.refused || plain.size.height <= first.size.height) return plain;
      let low = first.size.height;
      let best = plain;
      while (best.size.height - low > 1) {
        const mid = Math.floor((low + best.size.height) / 2);
        const probe = at(width, mid);
        if (!probe.refused && hiddenForSpace(probe) <= hiddenForSpace(plain)) best = probe; else low = mid;
      }
      return best;
    }
    return at(width, height);
  }
  return atSize ? atSize(options, compactFallback) : fitSizeMemo(definition, data, options, compactFallback);
}

/** Call state must not appear in a chart's returned derived options. */
function withoutCallState<O extends ChartOptions>(options: O | undefined): O | undefined {
  if (!options || !(CARD_HEIGHT_MEMO in options || LAYOUT_CALL in options || FULL_LAYOUT_PROBE in options || FIXED_SIZE_PROBE in options
    || ACCEPTANCE_PROBE in options)) return options;
  const { [CARD_HEIGHT_MEMO]: _card, [LAYOUT_CALL]: _call, [FULL_LAYOUT_PROBE]: _probe, [FIXED_SIZE_PROBE]: _fixed,
    [ACCEPTANCE_PROBE]: _accept, ...raw } = options as O & Record<symbol, unknown>;
  return raw as O;
}

/**
 * Request-scoped memo of full layouts. The registry and the size searches ask for the same
 * layout again from separate prepared runs (key, unit line and note passes; the wider card).
 * It is open only during the outermost synchronous layout call and cleared at its exit, so no
 * result outlives the request or reaches another data or options object.
 */
// One entry per key: the layout, when it did not read the plot share, or its layouts by share.
let layoutMemo: Map<string, { result?: LayoutResult<object, object>; byShare?: Map<number | undefined, LayoutResult<object, object>> }> | undefined;
const memoObjectIds = new WeakMap<object, number>();
// Symbol ids live for one request: a caller's fresh symbols are not kept after it.
let memoSymbolIds = new Map<symbol, number>();
let memoNextId = 0;

/** Run one top-level layout call with a fresh full-layout memo; nested calls share it. */
export function withLayoutMemo<T>(run: () => T): T {
  if (layoutMemo) return run();
  layoutMemo = new Map();
  try { return withEngineNotes(() => withCategoryRowPlans(run)); } finally { layoutMemo = undefined; memoSymbolIds = new Map(); }
}

function memoId(value: object | symbol): number {
  if (typeof value === 'symbol') {
    let id = memoSymbolIds.get(value);
    if (id === undefined) memoSymbolIds.set(value, id = ++memoNextId);
    return id;
  }
  let id = memoObjectIds.get(value);
  if (id === undefined) memoObjectIds.set(value, id = ++memoNextId);
  return id;
}

/**
 * Every input by value: own string and symbol keys, nested ones in their order (a layout can
 * read them in that order), the top-level options sorted by name. Frozen objects (themes), functions, class instances, Maps and Sets, and the
 * call-state objects count by identity; neither can change during one synchronous call.
 */
function memoKey(value: unknown, depth = 0): string {
  // Every value and every name counts against the budget: a long numeric array must not bypass it.
  if (--memoKeyBudget < 0) throw MEMO_KEY_TOO_LONG;
  switch (typeof value) {
    case 'string':
      if ((memoKeyBudget -= value.length) < 0) throw MEMO_KEY_TOO_LONG;
      return JSON.stringify(value);
    case 'number': {
      const text = Object.is(value, -0) ? '-0' : String(value);
      if ((memoKeyBudget -= text.length) < 0) throw MEMO_KEY_TOO_LONG;
      return text;
    }
    case 'boolean': return value ? 't' : 'f';
    case 'undefined': return 'u';
    case 'bigint': return `${value}n`;
    case 'symbol': return `s${memoId(value)}`;
    case 'function': return `#${memoId(value)}`;
  }
  if (value === null) return 'n';
  // The data object is in the key by identity already (a note context carries it again).
  if (value === memoKeyData) return 'D';
  if ((memoKeyBudget -= 8) < 0) throw MEMO_KEY_TOO_LONG;
  const object = value as object;
  if (Array.isArray(object)) {
    if (depth > 24 || Object.isFrozen(object)) return `#${memoId(object)}`;
    let out = '[';
    for (let i = 0; i < object.length; i++) out += (i ? ',' : '') + (i in object ? memoKey(object[i], depth + 1) : 'h');
    return Object.keys(object).length === object.length ? `${out}]` : `#${memoId(object)}`;
  }
  if (depth > 24 || Object.isFrozen(object)) return `#${memoId(object)}`;
  if (object instanceof Set) {
    let out = 'S[';
    for (const item of object) out += `${memoKey(item, depth + 1)},`;
    return `${out}]`;
  }
  if (object instanceof Map) {
    let out = 'M[';
    for (const [name, item] of object) out += `${memoKey(name, depth + 1)}:${memoKey(item, depth + 1)},`;
    return `${out}]`;
  }
  const proto = Object.getPrototypeOf(object);
  if (proto !== Object.prototype && proto !== null) return `#${memoId(object)}`;
  let out = '{';
  // The layout reads top-level options by name; the passes build them in different orders.
  // An option set to undefined reads as one left out (`options.legend`, `?.`, spreads).
  if (depth === 0) {
    const own = Reflect.ownKeys(object).filter(key => (object as Record<PropertyKey, unknown>)[key] !== undefined);
    const ordered = own.map(key => [memoName(key), key] as const)
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    for (const [name, key] of ordered) out += `${name}:${memoKey((object as Record<PropertyKey, unknown>)[key], 1)},`;
    return `${out}}`;
  }
  for (const key of Reflect.ownKeys(object)) {
    const entry = (object as Record<PropertyKey, unknown>)[key];
    out += `${memoName(key)}:${memoKey(entry, depth + 1)},`;
  }
  return `${out}}`;
}

/** A property name in a memo key, counted against the key budget. */
function memoName(key: string | symbol): string {
  const name = typeof key === 'symbol' ? `s${memoId(key)}` : JSON.stringify(key);
  if ((memoKeyBudget -= name.length) < 0) throw MEMO_KEY_TOO_LONG;
  return name;
}

/**
 * Key size budget, in characters. A key that grows past it (a note that carries hundreds of
 * hidden labels) costs more to build than a repeat would save; that layout is not memoized.
 */
const MEMO_KEY_LIMIT = 200_000;
const MEMO_KEY_TOO_LONG = Symbol('memoKeyTooLong');
let memoKeyBudget = 0;
let memoKeyData: unknown;

/** A result for one caller: the fields callers change are its own, the rest is shared. */
function memoCopy<M extends object, DV extends object>(result: LayoutResult<M, DV>): LayoutResult<M, DV> {
  const copy = { ...result, warnings: [...result.warnings], ...(result.sizing ? { sizing: { ...result.sizing } } : {}) } as LayoutResult<M, DV>;
  const floor = plotChromeFloor.get(result);
  if (floor !== undefined) plotChromeFloor.set(copy, floor);
  return copy;
}

/** fitSize through the request memo: the same chart, data object, options and mode give the same layout. */
function fitSizeMemo<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, compactFallback: boolean,
): LayoutResult<M, DV> {
  const memo = layoutMemo;
  // A grid panel is small and a grid lays out many: its key costs about as much as its layout.
  // Gantt acceptance probes can skip label repairs, so they must not enter the full-layout memo.
  if (!memo || data === null || typeof data !== 'object' || panelTypeClass(options) !== undefined
    || (definition.type === 'gantt' && (options as { [ACCEPTANCE_PROBE]?: boolean } | undefined)?.[ACCEPTANCE_PROBE])) {
    return fitSize(definition, data, options, compactFallback);
  }
  // The wider-card memo reaches only a Gantt layout (fitSize strips it for every other type), and
  // its contents are call state: it counts by identity there and not at all elsewhere. The other
  // call-state markers never reach the chart (withoutCallState), so they are not in the key either.
  const card = (options as { [CARD_HEIGHT_MEMO]?: object } | undefined)?.[CARD_HEIGHT_MEMO];
  // The plot share joins the key below, and only for a layout that reads it (shareRead).
  const share = (options as { [PLOT_SHARE]?: number } | undefined)?.[PLOT_SHARE];
  let keyed: unknown = withoutCallState(options);
  if (share !== undefined) {
    const { [PLOT_SHARE]: _share, ...rest } = keyed as O & { [PLOT_SHARE]?: number };
    keyed = rest;
  }
  memoKeyBudget = MEMO_KEY_LIMIT;
  memoKeyData = data;
  let optionsKey: string;
  try {
    optionsKey = memoKey(keyed);
  } catch (error) {
    if (error !== MEMO_KEY_TOO_LONG) throw error;
    return fitSize(definition, data, options, compactFallback);
  } finally {
    memoKeyData = undefined;
  }
  const key = `${memoId(definition)}|${memoId(data)}|${compactFallback}|${definition.type === 'gantt' && card ? memoId(card) : ''}|${optionsKey}`;
  // Until a layout reads the share, it runs the same for every share; so either none of the
  // layouts under this key read it (result) or all do (byShare). The long key is hashed once.
  const entry = memo.get(key) ?? {};
  if (entry.result) return memoCopy(entry.result as LayoutResult<M, DV>);
  const shared = entry.byShare?.get(share);
  if (shared) {
    shareRead = true;
    return memoCopy(shared as LayoutResult<M, DV>);
  }
  const outer = shareRead;
  shareRead = false;
  let result: LayoutResult<M, DV>;
  let readsShare = true;
  try {
    result = fitSize(definition, data, options, compactFallback);
    readsShare = shareRead;
  } finally {
    shareRead = outer || readsShare;
  }
  const copy = memoCopy(result) as LayoutResult<object, object>;
  if (readsShare) (entry.byShare ??= new Map()).set(share, copy);
  else entry.result = copy;
  memo.set(key, entry);
  return result;
}

/** Lay out one fixed size. Height searches never enter the search again. */
function fitSize<D, O extends ChartOptions, M extends object, DV extends object>(
  definition: ChartCore<D, O, M, DV>, data: D, options: O | undefined, compactFallback: boolean,
): LayoutResult<M, DV> {
  const declared = declaredSizing(definition, options);
  const requested = resolveSize(options?.size, options?.target);
  const nested = panelTypeClass(options) !== undefined;
  const floor = requestFloor(declared);
  // Between the compact floor and the type's own minimum the chart is drawn
  // tight: no legend, few value labels, one title line, scaled spacing. A
  // canvas below the minimum on either axis (a narrow slot, or a wide and
  // short one) draws there; `belowMinimum: 'refuse'` keeps the refusal.
  // A pie whose height the chart takes grows to its full floor: only a pinned height draws it compact (refuse-less).
  const growsFull = definition.type === 'pie' && !((options as TargetSizeOptions | undefined)?.[TARGET_SIZE]
    ?? resolveTargetSize(options?.target ?? DEFAULT_TARGET, options?.size)).fixed.height;
  const tight = !nested && (compactFallback || belowMinimum(declared, growsFull ? { ...requested, height: declared.minHeight } : requested, options, definition.type));
  // The tight band lowers what the chart ACCEPTS, never what it reports. A
  // caller asking `measure` still hears the type's own 480 x 270 alongside the
  // compact floor, and a measured requirement (a bar's five rows) still gates.
  const gatePolicy = tight ? { ...declared, minWidth: floor.width, minHeight: floor.height } : declared;
  if (!nested && !fitsSize(requested, definition.type === 'grid' ? { ...gatePolicy, minHeight: 0 } : gatePolicy)) {
    return sizeRefusal(definition.type, definition.title, requested, resolveSizing(gatePolicy, requested));
  }
  // Compact is chosen for a chart only below its minimum. At or
  // above it the chart is full: a 489px panel in a two-column dashboard is
  // the normal case, and the title there stays a title. An authored mode wins
  // everywhere except in the tight band, which has no room for a full frame.
  // Mekko's own `mode` names its calculation, so Mekko is always full.
  const mode: 'full' | 'compact' = tight || (definition.type !== 'mekko' && options?.mode === 'compact')
    ? 'compact' : 'full';
  const layoutOptions = mode === 'compact'
    ? compactOptions(definition.type, options ?? {} as O, tight ? floor : undefined, requested.width)
    : options;
  // KPI owns an M-column frame.
  // This marker reaches only the raw card layout, after the standalone size gate.
  const rawOptions = definition.type === 'kpi'
    ? { ...layoutOptions, typeClass: 'M' } as unknown as O : layoutOptions;
  const layout = (runOptions: O | undefined) => {
    const clean = withoutCallState(runOptions);
    // Gantt's own content-height rule requests the next wider card. It removes
    // the call marker before retaining its full-mode options.
    const memo = (runOptions as (O & { [CARD_HEIGHT_MEMO]?: CardHeightMemo }) | undefined)?.[CARD_HEIGHT_MEMO];
    return definition.layout(data, definition.type === 'gantt' ? { ...clean, ...(memo ? { [CARD_HEIGHT_MEMO]: memo } : {}),
      ...((runOptions as { [ACCEPTANCE_PROBE]?: boolean } | undefined)?.[ACCEPTANCE_PROBE] ? { [ACCEPTANCE_PROBE]: true } : {}),
    } as unknown as O : clean);
  };
  let geometry = layout(rawOptions);
  // The fixed-slot drop order in fitOrRepair keeps a subtitle that does not fit in the notes list.
  const heightShort = tight && requested.height < declared.minHeight;
  if (definition.type === 'slope' && !geometry.refused && (layoutOptions as { variant?: string } | undefined)?.variant === 'diverging') {
    // Diverging panels measure their own natural height (slope/diverging.ts).
    const naturalHeight = geometry.sizing!.naturalHeight;
    if (options?.size === undefined && !nested && Math.abs(naturalHeight - geometry.size.height) > 2) {
      geometry = layout({ ...layoutOptions, size: { width: geometry.size.width, height: naturalHeight } } as O);
    }
  } else if (definition.type === 'slope' && !geometry.refused) {
    const reference = geometry.size.width === 720 && geometry.size.height === 405 ? geometry
      : layout({ ...layoutOptions, size: { width: 720, height: 405 } } as O);
    const naturalHeight = slopeContentHeight(geometry, reference.refused ? geometry.plot.h : reference.plot.h);
    // An unpinned slope is drawn at its content height; a pinned one reports it.
    if (options?.size === undefined && !nested && Math.abs(naturalHeight - geometry.size.height) > 2) {
      geometry = layout({ ...layoutOptions, size: { width: geometry.size.width, height: naturalHeight } } as O);
    }
    if (!geometry.refused) geometry.sizing = { ...geometry.sizing, naturalHeight } as ResolvedSizing;
  }
  if (geometry.refused) return geometry;
  // A React footer's button row takes the plot under its floor before the chart refuses (liveFooterExtra).
  const footerExtra = liveFooterExtra.get(geometry.frame) ?? 0;
  const floorWithFooter = Math.max(geometry.sizing?.minHeight ?? 0, geometry.frame.minHeight ?? 0, geometry.frame.plotMinHeight ?? 0,
    (heightShort || tight) && HOLDS_COMPACT_PLOT.has(definition.type)
      ? Math.ceil(geometry.size.height + (atHardMinimum(options) && !HARD_KEEPS_COMPACT_PLOT.has(definition.type) ? HARD_COMPACT_PLOT : MIN_COMPACT_PLOT) - plotForFloor(geometry).h) : 0);
  const measured = {
    ...geometry.sizing,
    ...(definition.type === 'kpi' ? { naturalWidth: Math.min(geometry.sizing?.naturalWidth ?? 360, 360) } : {}),
    // The height that holds a plot of MIN_COMPACT_PLOT px is the measured floor (HOLDS_COMPACT_PLOT).
    minHeight: floorWithFooter - footerExtra,
    measuredMinHeight: Math.max(geometry.sizing?.measuredMinHeight ?? 0, geometry.frame.minHeight ?? 0, isVarianceTier(layoutOptions) ? 0 : geometry.frame.plotMinHeight ?? 0),
  };
  const policy = definition.type === 'grid' && measured.fit === 'content' ? { ...declared, minHeight: 0 } : declared;
  geometry.sizing = resolveSizing(nested && measured.fit === 'content' ? { ...policy, minWidth: 0 } : policy, geometry.size, measured);
  // A type's compact floor holds only for data that has its compact form (ChartCore.compactForm).
  if (geometry.sizing.compactFloor !== undefined && definition.compactForm?.(data, options) === false) {
    const { compactFloor: _none, ...sizing } = geometry.sizing;
    geometry.sizing = sizing;
  }
  const gate = tight ? resolveSizing(gatePolicy, geometry.size, measured) : geometry.sizing;
  geometry.mode = mode;
  const omittedNotes = mode === 'compact' ? omittedCompactNotes(definition.type, options ?? {}) : [];
  if (omittedNotes.length > 0) {
    geometry.a11y.desc += ` Notes: ${omittedNotes.join('; ')}.`;
    geometry.a11y.compactNotes = [...(geometry.a11y.compactNotes ?? []), ...omittedNotes];
    geometry.warnings.push({
      code: 'compact-notes-omitted', severity: 'info',
      message: `compact mode leaves these notes off the canvas and in the accessible description: ${omittedNotes.join(' | ')}`,
    });
  }
  if (footerExtra > 0 && geometry.size.height < floorWithFooter && !geometry.warnings.some(warning => warning.code === 'plot-under-floor')) {
    const height = Math.ceil(floorWithFooter);
    geometry.warnings.push({
      code: 'plot-under-floor', severity: 'warn',
      message: `the source and notes rows under the chart take ${Math.ceil(footerExtra)} px from the plot, which draws under its floor; the chart needs ${height} px`,
      suggest: `Give the chart ${height} px of height, or leave the height out so the chart takes it.`,
      field: ['options', 'size'],
      fix: [{ op: 'replace', path: '/options/size', value: { width: geometry.size.width, height } }],
    });
  }
  // A diagram already explains which required content failed. Preserve that
  // refusal and its measured repair instead of replacing it with a generic one.
  if (nested || geometry.warnings.some(w => w.code === 'invalid-options')
    || (definition.type === 'diagram' && isRefused(geometry)) || fitsSize(geometry.size, gate)) return geometry;
  const refusal = sizeRefusal(definition.type, definition.title, geometry.size, gate);
  const chrome = plotChromeFloor.get(geometry.frame);
  if (chrome !== undefined) plotChromeFloor.set(refusal, chrome);
  return refusal;
}
