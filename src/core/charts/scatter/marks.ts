import type { SlotCandidate } from '../../label/solver';
import type { Theme } from '../../types/theme';
import { formatAutomaticNumber } from '../../format';
import { emphasisWeight, secondaryFont, strokeToken, dashToken } from '../../theme';
/**
 * Scatter phase 2: scales in, scene nodes out. Zone backgrounds, both
 * value axes, quadrant shading, zero rules, the point marks and the quadrant
 * dividers, in paint order. Everything the phase claims goes into an
 * OccupiedIndex of its own, in claim order, which the phase returns.
 */

import type { Rect } from '../../geometry';
import { layoutValueAxis } from '../../axis';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import type { Id } from '../../types/cell';
import type { MarkerShape } from '../../types/data';
import type { AxisGeometry, LintWarning, Paint, SceneDisplay, SceneNode } from '../../types/scene';
import { clampStateOf } from './clamp';
import { fitLogTicks, logSpecFormat } from './logAxis';
import { fmtPathNumber as fmtN } from '../../curve';
import {
  type NormPt,
  type QuadrantBox,
  type QuadrantDerived,
  type ScatterDomain,
  type ScatterEnv,
  type ScatterMarks,
  type ScatterPaints,
  type ScatterPlotArea,
} from './model';
import { inView } from './domain';
import { QUALITATIVE_GAP, qualitativeColumn } from './plot';
import { drawFrontier } from './frontier';
import { drawScatterTrends, type TrendLine } from './trend';
import { bandedAxes, layoutScatterZones, type ZoneGeometry } from './zones';
import { pushAll } from '../../arrays';

/** The ring around a highlighted point: its gap from a dot and from a bubble. */
export const HIGHLIGHT_RING_GAP = 4;
const BUBBLE_RING_GAP = 3;
/** The tick count a bubble chart's x axis asks for. */
const BUBBLE_X_TICKS = 8;
/** Length of a tick mark under the x axis line. */
const X_TICK_MARK = 4;

/**
 * A bubble whose size the scale cannot draw gets a marker of its own:
 * a ring for size 0, a plus for a point without a size, a cross for a size the
 * data gives as negative or not a number. A positive size too small for the
 * smallest bubble keeps the smallest filled dot.
 */
type SizeMarker = 'zero' | 'missing' | 'invalid';
/** Bubbles at least this large claim their circle outline instead of their box. */
const BUBBLE_OUTLINE_MIN_R = 8;

export function sizeMarkerOf(p: NormPt): SizeMarker | undefined {
  return p.sizeInvalid ? 'invalid' : p.size === null ? 'missing' : p.size === 0 ? 'zero' : undefined;
}

function sizeMarkerNode(theme: Theme, kind: SizeMarker, input: { id: Id; cx: number; cy: number; r: number; paint: Paint; owner: { pointId: Id }; display: SceneDisplay }): SceneNode {
  const { id, cx, cy, owner, display, paint } = input;
  const r = Math.max(3.5, input.r + 1);
  if (kind === 'zero') return { t: 'circle', id, cx, cy, r, fill: { token: 'background' }, stroke: paint, strokeWidth: strokeToken(theme, 'mark'), owner, part: 'point', display };
  const k = kind === 'invalid' ? r * Math.SQRT1_2 : r;
  const d = kind === 'invalid'
    ? `M${fmtN(cx - k)} ${fmtN(cy - k)}L${fmtN(cx + k)} ${fmtN(cy + k)}M${fmtN(cx - k)} ${fmtN(cy + k)}L${fmtN(cx + k)} ${fmtN(cy - k)}`
    : `M${fmtN(cx - k)} ${fmtN(cy)}H${fmtN(cx + k)}M${fmtN(cx)} ${fmtN(cy - k)}V${fmtN(cy + k)}`;
  return { t: 'path', id, d, stroke: paint, width: strokeToken(theme, 'mark'), owner, part: 'point', display };
}

/** Outline weight and dash of the open marker a clipped point is drawn with. */



/** A plotted point where it is drawn: the axis edge for a clipped one. */
export interface PlacedPoint {
  p: NormPt;
  cx: number;
  cy: number;
  r: number;
}

/** Phase 2 output. */
export interface ScatterMarkGeometry {
  /** In paint order, after the frame's own nodes. */
  nodes: SceneNode[];
  /** The phase's own index: every rect it claimed, in claim order. */
  claims: OccupiedIndex;
  axes: AxisGeometry[];
  zones: ZoneGeometry;
  placed: PlacedPoint[];
  marks: ScatterMarks;
  /** Where the dividers cross, pulled onto the plot; 0 when there are no quadrants. */
  split: { x: number; y: number };
  /** The drawn trend lines (options.trend), in fit order. */
  trendLines: TrendLine[];
  /** Which declared cut values print bold as a tick label. */
  cutTicks: { x: boolean; y: boolean };
  /** Pixel positions of the vertical (x) and horizontal (y) rules: zero lines, dividers, value lines. */
  rules: { x: number[]; y: number[] };
  /** Dots drawn in the dense paths (DENSE_POINTS), when there are any. */
  densePoints?: number;
  /**
   * Point label seats already built on this geometry, by point and text
   * (labels.ts). One layout run plans its labels several times on one plot;
   * the memo lives as long as this geometry, one run.
   */
  seatMemo?: Map<string, SlotCandidate[]>;
  /** A point's label paints, by point id, worked out once per run (labels.ts). */
  paintMemo?: Map<unknown, { inside?: Paint; fill?: string; fillKnown?: true }>;
}

/**
 * One point's mark.
 *
 * A CLIPPED point is drawn at the axis edge as an OPEN marker: the outline of
 * its own symbol, unfilled and dashed. Open rather than filled, because the
 * position is not the point's position: the reader has to see a value that ran
 * off the scale, not a unit that happens to sit at the edge. Dashed rather than
 * solid, because the notation hollow convention (`scenario` PL/FC) already owns a
 * solid outline over the page background, and two different facts must not
 * share one glyph.
 */
function pointMarkNode(theme: Theme, input: {
  id: Id;
  marker: MarkerShape;
  cx: number;
  cy: number;
  r: number;
  /** The point's own colour: its fill when filled, its outline when open. */
  paint: Paint;
  /** Notation plan/forecast convention: background fill with a solid outline. */
  hollow: boolean;
  clipped: boolean;
  owner: { pointId: Id };
  display: SceneDisplay;
}): SceneNode {
  const { id, marker, cx, cy, r, owner, display } = input;
  const shared = { id, owner, part: 'point', display } as const;
  const side = r * 1.8;
  const d =
    marker === 'circle'
      ? `M${fmtN(cx - r)} ${fmtN(cy)}A${fmtN(r)} ${fmtN(r)} 0 1 0 ${fmtN(cx + r)} ${fmtN(cy)}A${fmtN(r)} ${fmtN(r)} 0 1 0 ${fmtN(cx - r)} ${fmtN(cy)}Z`
      : marker === 'square'
        ? `M${fmtN(cx - side / 2)} ${fmtN(cy - side / 2)}H${fmtN(cx + side / 2)}V${fmtN(cy + side / 2)}H${fmtN(cx - side / 2)}Z`
        : marker === 'triangle'
          ? `M${fmtN(cx)} ${fmtN(cy - r * 1.2)}L${fmtN(cx + r * 1.15)} ${fmtN(cy + r)}L${fmtN(cx - r * 1.15)} ${fmtN(cy + r)}Z`
          : `M${fmtN(cx)} ${fmtN(cy - r * 1.3)}L${fmtN(cx + r * 1.3)} ${fmtN(cy)}L${fmtN(cx)} ${fmtN(cy + r * 1.3)}L${fmtN(cx - r * 1.3)} ${fmtN(cy)}Z`;
  if (input.clipped) {
    return { t: 'path', ...shared, d, stroke: input.paint, width: strokeToken(theme, 'mark'), dash: dashToken(theme, 'dotted'), lineCap: 'round' as const };
  }
  const fill: Paint = input.hollow ? { token: 'background' } : input.paint;
  const stroke: Paint | undefined = input.hollow ? input.paint : undefined;
  if (marker === 'circle') {
    // A filled circle takes a 1 px background outline, so touching dots and overlapping bubbles stay apart.
    return { t: 'circle', ...shared, cx, cy, r, fill, ...(stroke ? { stroke, strokeWidth: strokeToken(theme, 'mark') } : { stroke: { token: 'background' }, strokeWidth: strokeToken(theme, 'rule') }) };
  }
  if (marker === 'square') {
    // A hollow square draws as the key's hollow box does, so mark and key agree.
    return {
      t: 'rect',
      ...shared,
      rect: { x: cx - side / 2, y: cy - side / 2, w: side, h: side },
      ...(input.hollow ? { fill: input.paint, pattern: 'hollow' as const } : { fill }),
    };
  }
  return { t: 'path', ...shared, d, fill, ...(stroke ? { stroke, width: strokeToken(theme, 'mark') } : {}) };
}

/** Both value axes, their titles and the frame lines (position encoding needs a frame). */
function scatterAxes(env: ScatterEnv, domain: ScatterDomain, area: ScatterPlotArea, nodes: SceneNode[], claims: OccupiedIndex, warnings: LintWarning[]): AxisGeometry[] {
  const { theme, measure, axisFmt, va } = env;
  const { plot, x, y, axisTitles, fonts } = area;
  const axes: AxisGeometry[] = [];
  if (!area.showAxes) return axes;
  if (area.qualitative) {
    qualitativeAxes(env, area, nodes, claims, warnings);
    return axes;
  }
  // A log axis prints the densest 1-2-5 tick set whose labels fit (fitLogTicks).
  // Each axis prints in its own format (options.axisFormat, else the chart's,
  // else a plain number). A linear axis goes through tickFormatter, one
  // decimal count for its ticks; a log axis gives each 1-2-5 tick the
  // decimals it needs (logSpecFormat).
  const ticksOf = (scale: typeof x, orient: 'x' | 'y') => {
    const spec = env.axisSpec[orient];
    // A cut value breaks the even tick ladder, so the 2x2 ticks are kept as given and only thinned where labels meet.
    if (!scale.log) return { format: axisFmt[orient], formatSpec: spec, ...(domain.ticks ? { ticks: domain.ticks[orient], ...(domain.quadrants.derived ? { keepEndTicks: true } : {}) } : {}) };
    const tickFmt = logSpecFormat(spec);
    return { format: tickFmt, ticks: fitLogTicks(scale, orient, tickFmt, fonts.tick, measure) };
  };
  // A strategy grid axis with band labels prints the bands, not numbers
  // on a strategy grid: its ticks keep their positions, without labels, rules or claims.
  const banded = bandedAxes(env, domain);
  const bandless = (axis: ReturnType<typeof layoutValueAxis>, orient: 'x' | 'y'): ReturnType<typeof layoutValueAxis> => {
    if (!banded[orient]) return axis;
    const labels = new Set(axis.axis.ticks.map((t) => t.labelId));
    return { ...axis, nodes: axis.nodes.filter((n) => !(n.t === 'text' && labels.has(n.id))), axis: { ...axis.axis, ticks: axis.axis.ticks.map(({ labelId: _label, ...t }) => t) } };
  };
  const scratch = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
  const yAxis = bandless(layoutValueAxis(
    // A dot scatter whose axes end on ticks draws a light rule at each y tick.
    { scale: y, plot, orient: 'y', gridlines: va.gridlines ?? tickGrid(domain), ...ticksOf(y, 'y'), theme, measure },
    banded.y ? scratch : claims,
  ), 'y');
  nodes.push(...yAxis.nodes);
  axes.push(yAxis.axis);
  // A bubble axis asks for a finer grid: ticks 10 apart left a 28-wide axis with three labels.
  const grid = env.options.zones !== undefined && 'grid' in env.options.zones;
  const xAxis = bandless(layoutValueAxis(
    { scale: x, plot, orient: 'x', gridlines: va.gridlines ?? false, ...ticksOf(x, 'x'), ...(domain.bubbleMode && !grid ? { tickCount: BUBBLE_X_TICKS } : {}), theme, measure, canvasWidth: env.size.width },
    banded.x ? scratch : claims,
  ), 'x');
  nodes.push(...xAxis.nodes);
  axes.push(xAxis.axis);
  if (axisTitles.x) {
    const size = measure(axisTitles.x, fonts.axisTitle);
    // Under the zone band labels, whose row the plot height already reserves.
    const rect: Rect = { x: plot.x + plot.w / 2 - size.width / 2, y: plot.y + plot.h + area.xAxisH + area.xBandH + 2, w: size.width, h: size.height };
    nodes.push({ t: 'text', id: 'axis:x:title', x: plot.x + plot.w / 2, y: rect.y, lines: [axisTitles.x], align: 'middle', typeRole: 'secondary', font: secondaryFont(env.theme), ink: { token: 'ink' }, owner: {}, part: 'axisTitle' });
    claims.claim(rect, 'axis', {}, 'axisTitle');
  }
  if (axisTitles.y) {
    const size = measure(axisTitles.y, fonts.axisTitle);
    // Over the band column too, when the grid prints y bands.
    const rect: Rect = { x: plot.x - area.yAxisW - (banded.y ? area.yBandW : 0), y: area.inner.y + 8, w: size.width, h: size.height };
    nodes.push({ t: 'text', id: 'axis:y:title', x: rect.x, y: rect.y, lines: [axisTitles.y], align: 'start', typeRole: 'secondary', font: secondaryFont(env.theme), ink: { token: 'ink' }, owner: {}, part: 'axisTitle' });
    claims.claim(rect, 'axis', {}, 'axisTitle');
  }
  // The frame lines and the x tick marks take the muted axis ink, so the
  // points and their names are the first read. A strategy grid keeps its ink frame: there the frame bounds the cells.
  const axisInk: Paint = grid ? { token: 'axis' } : { token: 'inkMuted' };
  const frameLine = (id: string, x1: number, y1: number, x2: number, y2: number): SceneNode =>
    ({ t: 'line', id, x1, y1, x2, y2, stroke: axisInk, width: strokeToken(theme, 'rule'), owner: {}, part: 'axisLine' });
  // A banded axis draws no frame line: the cells bound the plot.
  if (!banded.x) {
    nodes.push(frameLine('axis:x:line', plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h));
    claims.claim({ x: plot.x, y: plot.y + plot.h - 1, w: plot.w, h: 2 }, 'axis', {});
  }
  if (!grid) {
    for (const tick of xAxis.axis.ticks) {
      if (typeof tick.at !== 'number') continue;
      nodes.push({ t: 'line', id: `axis:x:tickMark:${tick.at}`, x1: tick.pos, y1: plot.y + plot.h, x2: tick.pos, y2: plot.y + plot.h + X_TICK_MARK, stroke: axisInk, width: strokeToken(theme, 'rule'), owner: {}, part: 'tickMark' });
    }
  }
  // With a rule at every y tick the gridlines carry the vertical scale; a y frame line would be one more line.
  if (!banded.y && !(tickGrid(domain) && (va.gridlines ?? true))) {
    nodes.push(frameLine('axis:y:line', plot.x, plot.y, plot.x, plot.y + plot.h));
    claims.claim({ x: plot.x - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
  }
  return axes;
}

/** A dot scatter on tick-aligned axes draws y gridlines; a 2x2 does not, its dividers are the rules. */
function tickGrid(domain: ScatterDomain): boolean {
  return domain.ticks !== undefined && domain.quadrants.derived === undefined;
}

/**
 * The tick labels that print a declared cut value exactly as the footnote and
 * the receipt do (`quadrants.xText` / `yText`). Only these can stand in for
 * the divider's tag; a computed cut keeps its tag, which names the statistic.
 */
function cutTickLabels(env: ScatterEnv, domain: ScatterDomain, axes: AxisGeometry[], nodes: readonly SceneNode[]): { x?: Id; y?: Id } {
  const decimal = formatAutomaticNumber(1.5, { locale: env.options.locale?.language, decimals: 1 }).replace(/\d/g, '');
  const q = domain.quadrants.derived;
  if (!q || !domain.ticks) return {};
  const found: { x?: Id; y?: Id } = {};
  for (const axis of axes) {
    const orient = axis.axis === 'x' ? 'x' : 'y';
    const drawn = orient === 'x' ? domain.quadrants.drawX : domain.quadrants.drawY;
    const source = orient === 'x' ? q.xSource : q.ySource;
    if (!drawn || source !== 'declared') continue;
    const cut = q[orient];
    const tick = axis.ticks.find((t) => typeof t.at === 'number' && Math.abs(t.at - cut) < 1e-9);
    const node = tick?.labelId === undefined ? undefined : nodes.find((n) => n.t === 'text' && n.id === tick.labelId);
    if (node?.t === 'text' && node.lines.length === 1 && samePrintedNumber(node.lines[0]!, orient === 'x' ? q.xText : q.yText, decimal)) found[orient] = node.id;
  }
  return found;
}

/**
 * Two printed numbers that read as the same value: the same text, or the
 * same text once trailing zeros after the locale's decimal mark are dropped
 * ("1.0" and "1"; "1,000" stays one thousand in English). Signs, units and
 * grouping must match exactly.
 */
function samePrintedNumber(a: string, b: string, decimal: string): boolean {
  const mark = decimal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const trim = (text: string) => text.replace(new RegExp(`(${mark}\\d*?)0+(?!\\d)`, 'g'), '$1').replace(new RegExp(`${mark}(?!\\d)`, 'g'), '');
  return a === b || (decimal.length === 1 && trim(a) === trim(b));
}

/** The declared cut values print bold in their axis rows, so the boundary is named where it is read. */
/** Sets the cut tick labels bold and says which cut values print there: their divider then needs no tag. */
function boldCutTicks(env: ScatterEnv, domain: ScatterDomain, axes: AxisGeometry[], nodes: SceneNode[]): { x: boolean; y: boolean } {
  const found = cutTickLabels(env, domain, axes, nodes);
  const ids = new Set(Object.values(found));
  nodes.forEach((node, i) => {
    if (node.t === 'text' && ids.has(node.id)) nodes[i] = { ...node, font: { ...node.font, weight: emphasisWeight(env.theme) } };
  });
  return { x: found.x !== undefined, y: found.y !== undefined };
}

/** An arrow from (x1, y1) to its head at (x2, y2), in the axis ink. */
function arrow(theme: Theme, id: string, x1: number, y1: number, x2: number, y2: number): SceneNode[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < ARROW_HEAD * 2) return [];
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const bx = x2 - ux * ARROW_HEAD, by = y2 - uy * ARROW_HEAD;
  const half = ARROW_HEAD * 0.55;
  return [
    { t: 'line', id, x1, y1, x2: bx, y2: by, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'axisArrow' },
    { t: 'path', id: `${id}:head`, d: `M${fmtN(x2)} ${fmtN(y2)}L${fmtN(bx - uy * half)} ${fmtN(by + ux * half)}L${fmtN(bx + uy * half)} ${fmtN(by - ux * half)}Z`, fill: { token: 'axis' }, owner: {}, part: 'axisArrow' },
  ];
}

const ARROW_HEAD = 7;

/**
 * Qualitative axes (options.qualitativeAxes): each axis reads as a direction.
 * The x row prints the low end, the bold title between two arrows and the high
 * end; the y column prints the high end at the top, the title in the middle
 * and the low end at the bottom, with the arrows between them.
 */
function qualitativeAxes(env: ScatterEnv, area: ScatterPlotArea, nodes: SceneNode[], claims: OccupiedIndex, warnings: LintWarning[]): void {
  const { measure } = env;
  const { plot, fonts, axisTitles } = area;
  const column = qualitativeColumn(env, fonts, area.inner.w);
  const bold = fonts.axisTitle;
  const gap = env.theme.space.labelPad * 2;
  const text = (id: string, x: number, y: number, lines: string[], align: 'start' | 'middle' | 'end', font: typeof bold): void => {
    const w = Math.max(...lines.map((line) => measure(line, font).width));
    const h = lines.length * font.size * (font.lineHeight ?? 1.2);
    nodes.push({ t: 'text', id, x, y, lines, align, typeRole: 'axis', font, ink: { token: 'ink' }, owner: {}, ...(id.endsWith(':title') ? { part: 'axisTitle' } : { part: 'axisEnd', role: 'axis' as const }) });
    claims.claim({ x: align === 'start' ? x : align === 'end' ? x - w : x - w / 2, y, w, h }, 'axis', {}, 'axisTitle');
  };
  const lineH = (font: typeof bold) => font.size * (font.lineHeight ?? 1.2);
  // x: Lower ← title → Higher, in the row under the plot.
  const rowY = plot.y + plot.h + 6;
  const midY = rowY + lineH(fonts.tick) / 2;
  const lowW = measure(column.low, fonts.tick).width, highW = measure(column.high, fonts.tick).width;
  const cx = plot.x + plot.w / 2;
  text('axis:x:low', plot.x, rowY, [column.low], 'start', fonts.tick);
  text('axis:x:high', plot.x + plot.w, rowY, [column.high], 'end', fonts.tick);
  const titleW = axisTitles.x ? measure(axisTitles.x, bold).width : 0;
  if (axisTitles.x) text('axis:x:title', cx, rowY, [axisTitles.x], 'middle', bold);
  nodes.push(...arrow(env.theme, 'axis:x:arrow-low', cx - titleW / 2 - gap, midY, plot.x + lowW + gap, midY));
  nodes.push(...arrow(env.theme, 'axis:x:arrow-high', cx + titleW / 2 + gap, midY, plot.x + plot.w - highW - gap, midY));
  // y: Higher at the top, the title in the middle, Lower at the bottom.
  const colX = plot.x - QUALITATIVE_GAP - column.width / 2;
  const tickH = lineH(fonts.tick);
  // A reversed value axis puts the low end at the top; the ends and arrows follow the scale (x is never reversed).
  const topY = plot.y, bottomY = plot.y + plot.h - tickH;
  const [highY, lowY] = env.va.reverse ? [bottomY, topY] : [topY, bottomY];
  // A column too short for its title and arrows keeps the two ends; one too short for two ends keeps the higher end.
  const titleH = column.lines.length * lineH(bold);
  const titleFits = plot.h > titleH + 2 * (tickH + 2 * gap);
  text('axis:y:high', colX, highY, [column.high], 'middle', fonts.tick);
  if (plot.h >= 2 * tickH) text('axis:y:low', colX, lowY, [column.low], 'middle', fonts.tick);
  if (column.lines.length && !titleFits) {
    warnings.push({
      code: 'axis-title-dropped',
      severity: 'warn',
      message: `the y axis title '${axisTitles.y}' is not drawn: the plot is ${Math.round(plot.h)} px high, too short for the title between its two ends`,
      suggest: 'Raise the canvas height, or shorten the y axis title.',
      field: ['options', 'axisTitles', 'y'],
    });
  }
  if (column.lines.length && titleFits) {
    const titleY = plot.y + plot.h / 2 - titleH / 2;
    text('axis:y:title', colX, titleY, column.lines, 'middle', bold);
    const toTop = arrow(env.theme, env.va.reverse ? 'axis:y:arrow-low' : 'axis:y:arrow-high', colX, titleY - gap, colX, plot.y + tickH + gap);
    const toBottom = arrow(env.theme, env.va.reverse ? 'axis:y:arrow-high' : 'axis:y:arrow-low', colX, titleY + titleH + gap, colX, plot.y + plot.h - tickH - gap);
    nodes.push(...toTop, ...toBottom);
  }
  const frameLine = (id: string, x1: number, y1: number, x2: number, y2: number): SceneNode =>
    ({ t: 'line', id, x1, y1, x2, y2, stroke: { token: 'axis' }, width: strokeToken(env.theme, 'rule'), owner: {}, part: 'axisLine' });
  // The plot is a box: a direction has no zero to stand on.
  nodes.push(frameLine('axis:x:line', plot.x, plot.y + plot.h, plot.x + plot.w, plot.y + plot.h),
    frameLine('axis:y:line', plot.x, plot.y, plot.x, plot.y + plot.h),
    frameLine('axis:top:line', plot.x, plot.y, plot.x + plot.w, plot.y),
    frameLine('axis:right:line', plot.x + plot.w, plot.y, plot.x + plot.w, plot.y + plot.h));
  claims.claim({ x: plot.x, y: plot.y + plot.h - 1, w: plot.w, h: 2 }, 'axis', {});
  claims.claim({ x: plot.x - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
  claims.claim({ x: plot.x, y: plot.y - 1, w: plot.w, h: 2 }, 'axis', {});
  claims.claim({ x: plot.x + plot.w - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
}

/**
 * One box of the 2x2. Cut points that fall outside the padded domain clamp to
 * the plot edge, so the boxes on their empty side collapse to zero width or
 * height. That is the truthful geometry of a 1x2: `voidBoxes` then refuses
 * their captions rather than letting a caption drift into a box it does not
 * describe.
 */
export function quadrantBoxRect(box: QuadrantBox, plot: Rect, split: { x: number; y: number }): Rect {
  return {
    x: box === 'tl' || box === 'bl' ? plot.x : split.x,
    y: box === 'tl' || box === 'tr' ? plot.y : split.y,
    w: box === 'tl' || box === 'bl' ? split.x - plot.x : plot.x + plot.w - split.x,
    h: box === 'tl' || box === 'tr' ? split.y - plot.y : plot.y + plot.h - split.y,
  };
}

/**
 * Neutral checkerboard only, and it is DECORATION: it never claims, because a
 * wash covering half the plot would block every label in it. Painted before the
 * marks so every mark, divider and label lands on top of it (z-order is
 * contract). tint(color, amount, bg) keeps (1 - amount) of `color`: 0.97 is a
 * barely there structural wash, quieter than a row tint. The checkerboard must
 * never become a first-read layer — it separates the boxes, it does not rank
 * them.
 */
/** The wash of the shaded boxes: neutralLight kept at a third, about #EEF2F5. */
const QUADRANT_TINT = 0.65;
/** The dividers' grey: the neutral mark role lightened a little, about #8C99A6. */
const DIVIDER_TINT = 0.12;

function quadrantTint(plot: Rect, split: { x: number; y: number }, nodes: SceneNode[]): void {
  const wash: Paint = { token: 'neutralLight', tint: QUADRANT_TINT };
  for (const box of ['tl', 'br'] as const) {
    const rect = quadrantBoxRect(box, plot, split);
    if (rect.w <= 0 || rect.h <= 0) continue;
    nodes.push({ t: 'rect', id: `quadrant:tint:${box}`, rect, fill: wash, owner: {}, part: 'quadrantTint' });
  }
}

/**
 * Zero lines when the domain crosses zero (quadrant scaffolding). A quadrant
 * divider AT zero replaces the zero rule on that axis — the two would paint the
 * same line twice, and the divider carries the cut-point tag.
 */
function zeroLines(theme: Theme, domain: ScatterDomain, area: ScatterPlotArea, nodes: SceneNode[], claims: OccupiedIndex): void {
  const { plot, x, y } = area;
  const q = domain.quadrants;
  const [dxLo, dxHi] = domain.dx;
  const [dyLo, dyHi] = domain.dy;
  const rule = (id: string, x1: number, y1: number, x2: number, y2: number): SceneNode =>
    // Solid and light: a zero line is scaffolding, apart from the dashed reference lines (value lines, trends).
    ({ t: 'line', id, x1, y1, x2, y2, stroke: { token: 'neutralLight' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'zeroLine' });
  if (dxLo < 0 && dxHi > 0 && !(q.drawX && q.derived!.x === 0)) {
    const zx = x(0);
    nodes.push(rule('axis:x:zero', zx, plot.y, zx, plot.y + plot.h));
    // Claimed as a reference line: a name may sit across it in front, with a halo.
    claims.claim({ x: zx - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {}, 'referenceLine');
  }
  if (dyLo < 0 && dyHi > 0 && !(q.drawY && q.derived!.y === 0)) {
    const zy = y(0);
    nodes.push(rule('axis:y:zero', plot.x, zy, plot.x + plot.w, zy));
    claims.claim({ x: plot.x, y: zy - 1, w: plot.w, h: 2 }, 'axis', {}, 'referenceLine');
  }
}

/**
 * Above this many drawn points a scatter draws its plain dots as one path per
 * paint: 10,000 circle elements wrote a 1.3 MB SVG, and 100,000 took 1.7 s
 * and 163 MB in a browser.
 */
export const DENSE_POINTS = 5000;
/** Row height (px) of the order a dense path visits its dots in. */
const DENSE_ROW = 8;

/**
 * The plain dots of a dense cloud, one path per paint and radius. Each dot is
 * a filled circle of two arcs, in relative moves between rounded coordinates
 * (no drift). Arcs, not zero-length round caps: some PDF and office renderers
 * drop a zero-length stroke. A dot with a state of its own (a ring, another
 * marker, hollow, clipped, a bubble) stays its own mark. The background halo
 * goes, since in a cloud this dense it cannot keep dots apart and one path
 * paints its overlaps once; the dot keeps the coloured radius the halo left.
 * The largest group paints first, so a small group is not buried under it.
 */
function denseDots(theme: Theme, domain: ScatterDomain, paints: ScatterPaints, drawOrder: readonly PlacedPoint[]): { nodes: SceneNode[]; drawn: Map<NormPt, Id> } | undefined {
  if (domain.bubbleMode || drawOrder.length <= DENSE_POINTS) return undefined;
  const runs = new Map<string, { paint: Paint; r: number; dots: { x: number; y: number; idx: number; p: NormPt }[] }>();
  const drawn = new Map<NormPt, Id>();
  const halo = strokeToken(theme, 'rule') / 2;
  for (const { p, cx, cy, r } of drawOrder) {
    if (p.marker !== 'circle' || paints.hollow(p) || paints.highlighted(p) || clampStateOf(domain.clamp, p.id) !== undefined) continue;
    const paint = paints.point(p);
    const key = `${JSON.stringify(paint)}\u0000${r}`;
    let run = runs.get(key);
    if (!run) runs.set(key, run = { paint, r: Math.max(r - halo, 0.5), dots: [] });
    run.dots.push({ x: Math.round((cx - run.r) * 100), y: Math.round(cy * 100), idx: p.idx, p });
  }
  if (runs.size === 0) return undefined;
  const ordered = [...runs.values()].sort((a, b) => b.dots.length - a.dots.length);
  const nodes = ordered.map(({ paint, r, dots }, k): SceneNode => {
    // One path paints its dots at once, so their order is free: rows of
    // DENSE_ROW px, left to right and back, keep each move short.
    const row = (y: number) => Math.floor(y / (DENSE_ROW * 100));
    dots.sort((a, b) => row(a.y) - row(b.y) || (row(a.y) % 2 === 0 ? a.x - b.x : b.x - a.x) || a.y - b.y || a.idx - b.idx);
    // Each circle starts and ends at its left edge, so the next move is relative to that edge.
    const rr = fmtN(r), dd = fmtN(2 * r);
    const circle = `a${rr} ${rr} 0 1 0 ${dd} 0a${rr} ${rr} 0 1 0-${dd} 0`;
    const parts: string[] = [];
    let x = 0, y = 0;
    for (const dot of dots) {
      parts.push(parts.length === 0 ? `M${hundredths(dot.x)} ${hundredths(dot.y)}` : `m${hundredths(dot.x - x)}${dot.y - y < 0 ? '' : ' '}${hundredths(dot.y - y)}`, circle);
      x = dot.x;
      y = dot.y;
    }
    // Each dot's record names its path, so a hover dims the other paths as it dims single dots.
    const id = `mark:dense:${k + 1}`;
    for (const dot of dots) drawn.set(dot.p, id);
    return { t: 'path', id, d: parts.join(''), fill: paint, owner: {}, part: 'point' };
  });
  return { nodes, drawn };
}

/** A count of hundredths as the shortest decimal: 7386 → 73.86, -120 → -1.2. */
function hundredths(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  const whole = Math.floor(a / 100), frac = a % 100;
  return frac === 0 ? `${sign}${whole}` : `${sign}${whole}.${frac < 10 ? `0${frac}` : String(frac).replace(/0$/, '')}`;
}

/** The point marks: larger bubbles first, smaller LAST (auto-front); claims in draw order. */
function pointMarks(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  paints: ScatterPaints,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): { placed: PlacedPoint[]; nodeIdOf: Map<Id, Id>; densePoints: number } {
  const { options, fmt, axisFmt } = env;
  const { clamp } = domain;
  const { x, y } = area;
  const placed = domain.pts.filter((p) => inView(options, domain.dx, domain.dy, p)).map((p) => ({ p, cx: x(clamp ? clamp.project.x(p.x) : p.x), cy: y(clamp ? clamp.project.y(p.y) : p.y), r: area.radiusOf(p) }));
  const drawOrder = [...placed].sort((a, b) => b.r - a.r || a.p.idx - b.p.idx);
  const ringGap = domain.bubbleMode ? BUBBLE_RING_GAP : HIGHLIGHT_RING_GAP;
  const nodeIdOf = new Map<Id, Id>();
  const dense = denseDots(env.theme, domain, paints, drawOrder);
  if (dense) pushAll(nodes, dense.nodes);
  for (const { p, cx, cy, r } of drawOrder) {
    const denseId = dense?.drawn.get(p);
    if (denseId) {
      nodeIdOf.set(p.id, denseId);
      claims.claim({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, 'mark', { pointId: p.id });
      continue;
    }
    if (p.marker === 'none') continue; // label-only mode
    const nodeId = `mark:${p.id}`;
    nodeIdOf.set(p.id, nodeId);
    const owner = { pointId: p.id };
    const clippedAt = clampStateOf(clamp, p.id);
    const display = {
      // The REAL coordinates, on a clipped point too: the mark moved, the
      // value did not, and this string is what the hover card and the
      // accessible data table read.
      value: [
        `X ${axisFmt.x(p.x)}`,
        `Y ${axisFmt.y(p.y)}`,
        ...(p.size === null ? [] : [`Size ${fmt(p.size)}`]),
      ].join(', '),
      ...(clippedAt ? { state: clippedAt } : {}),
    };
    const odd = domain.bubbleMode ? sizeMarkerOf(p) : undefined;
    nodes.push(odd
      ? sizeMarkerNode(env.theme, odd, { id: nodeId, cx, cy, r, paint: paints.point(p), owner, display })
      : pointMarkNode(env.theme, {
          id: nodeId,
          marker: p.marker,
          cx,
          cy,
          r,
          paint: paints.point(p),
          hollow: paints.hollow(p),
          clipped: clippedAt !== undefined,
          owner,
          display,
        }));
    // A highlighted point keeps its fill and takes a ring.
    if (paints.highlighted(p)) {
      const rr = r + ringGap;
      nodes.push({ t: 'path', id: `${nodeId}:ring`, d: `M${fmtN(cx - rr)} ${fmtN(cy)}A${fmtN(rr)} ${fmtN(rr)} 0 1 0 ${fmtN(cx + rr)} ${fmtN(cy)}A${fmtN(rr)} ${fmtN(rr)} 0 1 0 ${fmtN(cx - rr)} ${fmtN(cy)}Z`, stroke: paints.ring, width: strokeToken(env.theme, 'mark'), owner, part: 'highlightRing' });
    }
    const reach = r + (paints.highlighted(p) ? ringGap + strokeToken(env.theme, 'mark') : 0);
    // A bubble claims its circle (a 32-gon around it), not its box: a value inside a small neighbour
    // stood 0.5 px into a large bubble's box corner and went to the note.
    const outline = domain.bubbleMode && !odd && reach >= BUBBLE_OUTLINE_MIN_R
      ? Array.from({ length: 32 }, (_, k) => ({ x: cx + reach / Math.cos(Math.PI / 32) * Math.cos(k * Math.PI / 16), y: cy + reach / Math.cos(Math.PI / 32) * Math.sin(k * Math.PI / 16) }))
      : undefined;
    claims.claim({ x: cx - reach, y: cy - reach, w: 2 * reach, h: 2 * reach }, 'mark', owner, undefined, outline);
  }
  return { placed, nodeIdOf, densePoints: dense?.drawn.size ?? 0 };
}

/**
 * Quadrant dividers paint AFTER the marks: on a 2x2 the boundary is the
 * argument, and a bubble sitting on a line the reader cannot see makes its own
 * side unfalsifiable.
 */
function quadrantDividers(
  theme: Theme,
  q: QuadrantDerived,
  drawn: { drawX: boolean; drawY: boolean },
  area: ScatterPlotArea,
  nodes: SceneNode[],
  claims: OccupiedIndex,
): void {
  const { plot } = area;
  const divider = (axis: 'x' | 'y', x1: number, y1: number, x2: number, y2: number): SceneNode =>
    ({ t: 'line', id: `quadrant:divider:${axis}`, x1, y1, x2, y2, stroke: { token: 'neutral', tint: DIVIDER_TINT }, width: strokeToken(theme, 'rule'), owner: {}, part: 'quadrantDivider' });
  if (drawn.drawX) {
    const qx = area.x(q.x);
    nodes.push(divider('x', qx, plot.y, qx, plot.y + plot.h));
    claims.claim({ x: qx - 1, y: plot.y, w: 2, h: plot.h }, 'axis', {});
  }
  if (drawn.drawY) {
    const qy = area.y(q.y);
    nodes.push(divider('y', plot.x, qy, plot.x + plot.w, qy));
    claims.claim({ x: plot.x, y: qy - 1, w: plot.w, h: 2 }, 'axis', {});
  }
}

/** valueLine pre-claims: labels must never sit under the line. Returns the lines' y positions. */
function claimValueLines(domain: ScatterDomain, area: ScatterPlotArea, claims: OccupiedIndex): number[] {
  const ys: number[] = [];
  domain.annotations.forEach((ann, n) => {
    if (ann.kind !== 'valueLine') return;
    const annId = ann.id ?? `valueLine-${n + 1}`;
    const v = ann.value === 'mean' || ann.value === undefined ? domain.meanY : ann.value;
    if (v === undefined) return;
    ys.push(area.y(v));
    // A reference line: a name of a point on it may stand across it, in front with a halo.
    claims.claim({ x: area.plot.x, y: area.y(v) - 1, w: area.plot.w, h: 2 }, 'annotation', { annotationId: annId }, 'referenceLine');
  });
  return ys;
}

/** Phase 2: the plot area and scales in, every mark and rule in paint order out. */
export function layoutScatterMarks(
  env: ScatterEnv,
  domain: ScatterDomain,
  area: ScatterPlotArea,
  paints: ScatterPaints,
  warnings: LintWarning[],
): ScatterMarkGeometry {
  const { plot } = area;
  const q = domain.quadrants.derived;
  const nodes: SceneNode[] = [];
  const claims = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
  const zones = layoutScatterZones(env, domain, area, nodes, claims);
  const axes = scatterAxes(env, domain, area, nodes, claims, warnings);
  const cutTicks = boldCutTicks(env, domain, axes, nodes);
  const split = {
    x: q ? Math.min(Math.max(area.x(q.x), plot.x), plot.x + plot.w) : 0,
    y: q ? Math.min(Math.max(area.y(q.y), plot.y), plot.y + plot.h) : 0,
  };
  if (q && (env.options.quadrants?.tint ?? 'none') === 'alternating') quadrantTint(plot, split, nodes);
  zeroLines(env.theme, domain, area, nodes, claims);
  const trendLines = drawScatterTrends(env.theme, domain.trends, domain, area, paints, nodes, claims);
  drawFrontier(domain.frontier, env, domain.pts, domain.clamp, area, nodes, claims);
  const { placed, nodeIdOf, densePoints } = pointMarks(env, domain, area, paints, nodes, claims);
  if (q) quadrantDividers(env.theme, q, domain.quadrants, area, nodes, claims);
  const valueLineYs = claimValueLines(domain, area, claims);
  // Every straight rule across the plot, so a point's labels can keep to its side.
  const rules = { x: [] as number[], y: valueLineYs };
  for (const node of nodes) {
    if (node.t !== 'line' || (node.part !== 'zeroLine' && node.part !== 'quadrantDivider')) continue;
    if (node.x1 === node.x2) rules.x.push(node.x1);
    else rules.y.push(node.y1);
  }
  const marks: ScatterMarks = {
    points: placed.map(({ p, cx, cy, r }) => ({
      id: p.id,
      cx,
      cy,
      r: p.marker === 'none' ? 0 : r,
      ...(nodeIdOf.has(p.id) ? { nodeId: nodeIdOf.get(p.id)! } : {}),
      ...(domain.clamp?.clipped.has(p.id) ? { clipped: true as const } : {}),
    })),
    ...(zones.marks.length ? { zones: zones.marks } : {}),
  };
  return { nodes, claims, axes, zones, placed, marks, split, trendLines, rules, cutTicks, ...(densePoints > 0 ? { densePoints } : {}) };
}
