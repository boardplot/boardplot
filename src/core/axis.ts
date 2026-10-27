import { gridDash, secondaryFont, strokeToken } from './theme';
/**
 * Value-axis rendering (pipeline stage: after scales, before marks).
 * Default OFF everywhere — direct labels are the default.
 * When shown: ticks on the nice grid, optional gridlines, labels claimed
 * into the OccupiedIndex so marks/labels never collide with them.
 */

import { MAGNITUDE_DIVISOR, decimalCap, formatWithSpec, neededDecimals, type NumberFormatSpec } from './formatSpec';
import { AUTO_MAX_DECIMALS, MAX_FORMAT_DECIMALS } from './formatPrecision';
import { sweepHide } from './collide';
import { tickLabelX } from './label/tickRow';
import type { Rect } from './geometry';
import { linearScale, type LinearScale } from './scale';
import { createOccupiedIndex, type OccupiedIndex } from './label/occupied';
import { resolveSubtitle } from './normalize/shared';
import { unitPrinted } from './frame';
import { wrapText, type FontSpec, type TextMeasurer } from './text';
import type { OwnerRef } from './types/cell';
import type { BaseOptions } from './types/options';
import { PRIORITY, type LabelRequest } from './label/solver';
import type { AxisGeometry, Geometry, Paint, PlacedLabel, SceneNode } from './types/scene';
import type { Theme } from './types/theme';
import { maxOf, minOf } from './arrays';

interface ValueAxisInput {
  scale: LinearScale;
  plot: Rect;
  /** 'y' = vertical value axis at the left; 'x' = horizontal at the bottom. */
  orient: 'y' | 'x';
  gridlines: boolean;
  format(value: number): string;
  /**
   * Exhibit style spec for TICK formatting. Ticks are
   * engine-chosen nice numbers, not data: their precision rasters over the
   * TICK SET, uniform per axis, never inherited from the data raster — a
   * 1-decimal exhibit keeps its integer ladder reading "20", not "20.0",
   * and a 0.5-step ladder reads "20.0/20.5" uniformly. When present this
   * takes precedence over `format` for tick text.
   */
  formatSpec?: NumberFormatSpec;
  theme: Theme;
  measure: TextMeasurer;
  tickCount?: number;
  /** Explicit tick values override the nice grid (dual-axis sync). */
  ticks?: number[];
  /** A rank ladder (bump): its first and last ticks are ranks, so thinning keeps them instead of a coarser regular step. */
  keepEndTicks?: boolean;
  /** Canvas width, for an x axis: an end label centred past it anchors inward. */
  canvasWidth?: number;
}

/**
 * Style-preserving tick formatter: decimals raster over the ticks themselves.
 * Every tick demands the decimals it needs, 100 and up included: the value-
 * label exemption from 100 would print a 0.5 step as "100, 101, 101, 102".
 * Ticks that roll to the next magnitude take their own decimals, and the cap
 * follows the ticks' size (decimalCap): 0.001 steps read "0.001", not "0.00".
 * Past the cap the decimals still grow until every tick reads apart: a
 * 0.0005 step near 2 would print "2.00" on five ticks in a row.
 */
export function tickFormatter(
  spec: NumberFormatSpec,
  ticks: readonly number[],
): (value: number) => string {
  // An engine-chosen scale follows the largest tick: ticks near 40 under a B
  // scale would print "0.00000004B".
  if (spec.autoMagnitude) {
    const largest = Math.max(0, maxOf(ticks.filter(Number.isFinite).map(Math.abs)));
    let magnitude = spec.magnitude;
    while (magnitude !== 'none' && largest < MAGNITUDE_DIVISOR[magnitude]) magnitude = magnitude === 't' ? 'bn' : magnitude === 'bn' ? 'm' : magnitude === 'm' ? 'k' : 'none';
    if (magnitude !== spec.magnitude) spec = { ...spec, magnitude, ...(magnitude === 'none' ? { autoMagnitude: undefined, rollMagnitude: undefined } : {}) };
  }
  const divisor = MAGNITUDE_DIVISOR[spec.magnitude];
  const scaled = ticks
    .map((tick) => tick / divisor)
    .filter((tick) => Number.isFinite(tick) && (spec.magnitude === 'none' || Math.abs(tick) < 1000));
  const cap = decimalCap(scaled, spec.decimals);
  // A remainder counts as float noise only below the axis's own largest tick,
  // so ticks near 1e-13 are not read as whole numbers and all print 0.
  const largest = Math.max(0, maxOf(scaled.map((tick) => Math.abs(tick))));
  const noise = largest > 0 && largest < 1 ? largest : 1;
  // Ticks share one precision; the value-label unit rule (wholeFrom) stays off the axis.
  // One scale down the axis: an engine-chosen M or B does not step down per tick
  // as value labels do ("0.5M", not "500k" under "1.0M"); zero prints bare.
  const tickSpec: NumberFormatSpec = { ...spec, autoMagnitude: undefined, wholeFrom: undefined, decimals: Math.max(0, maxOf(scaled.map((tick) => neededDecimals(tick, cap, noise, spec.decimals)))) };
  const finite = ticks.filter((tick) => Number.isFinite(tick));
  const distinct = () => new Set(finite.map((tick) => formatWithSpec(tick, tickSpec))).size === new Set(finite).size;
  while (tickSpec.decimals < MAX_FORMAT_DECIMALS && !distinct()) {
    tickSpec.decimals++;
    // Distinct ticks win over the automatic AUTO_MAX_DECIMALS cap: 2.00001 and 2.00002 would all read "2.0000".
    if (tickSpec.decimals > AUTO_MAX_DECIMALS) tickSpec.automatic = false;
  }
  // Beside ticks in scientific notation ("4.0 × 10⁻¹³") zero prints "0", not "0.0000000000000".
  const scientific = finite.some((tick) => tick !== 0 && formatWithSpec(tick, tickSpec).includes('×'));
  return (value: number) => formatWithSpec(value, (spec.autoMagnitude || scientific) && value === 0 ? { ...tickSpec, magnitude: 'none', decimals: 0 } : tickSpec);
}

function thinAxisTicks(
  ticks: readonly number[],
  scale: LinearScale,
  orient: ValueAxisInput['orient'],
  format: (value: number) => string,
  font: FontSpec,
  measure: TextMeasurer,
  labelX: (pos: number, width: number, index: number, count: number) => number,
  keepEnds = false,
): number[] {
  if (ticks.length <= 2) return [...ticks];
  const itemsFor = (values: readonly number[]) => values.map((tick, index) => {
    const size = measure(format(tick), font);
    const pos = scale(tick);
    const extent = orient === 'x' ? size.width : size.height;
    const start =
      orient === 'x'
        ? labelX(pos, size.width, index, values.length)
        : pos - size.height / 2;
    const endpoint = index === 0 || index === values.length - 1;
    return {
      start,
      size: extent,
      priority: endpoint ? 2 : tick === 0 ? 1 : 0,
    };
  });
  if (!scale.log && !scale.break && !keepEnds) {
    const step = ticks[1]! - ticks[0]!;
    const regular = ticks.every((tick, index) => index === 0 || Math.abs(tick - ticks[index - 1]! - step) <= Math.abs(step) * 1e-9)
      ? [...ticks] : scale.ticks();
    if (regular.length <= 2) return regular;
    const baseStep = Math.abs(regular[1]! - regular[0]!);
    const origin = regular[0]! - Math.round(regular[0]! / baseStep) * baseStep;
    // Coarsen the whole ladder; retaining off-step endpoints makes a linear axis look uneven.
    for (let stride = 1; stride <= regular.length; stride++) {
      const kept = regular.filter(tick => Math.abs((tick - origin) / (baseStep * stride) - Math.round((tick - origin) / (baseStep * stride))) < 1e-9);
      if (kept.length > 0 && sweepHide(itemsFor(kept), 2).every(Boolean)) return kept;
    }
  }
  const keep = sweepHide(itemsFor(ticks), 2);
  return ticks.filter((_, index) => keep[index]);
}

interface ValueAxisResult {
  nodes: SceneNode[];
  axis: AxisGeometry;
  /** Width (y) or height (x) consumed left of / below the plot. */
  reserved: number;
}

interface BreakGlyphResult {
  nodes: SceneNode[];
  nodeIds: string[];
  rect: Rect;
}

/** Recover the rendered linear y-domain from two numeric ticks and the plot bounds. */
export function inferLinearYDomain(geometry: Geometry<object, object>): [number, number] | null {
  const ticks = geometry.axes
    .find((axis) => axis.axis === 'y')
    ?.ticks.filter((tick): tick is typeof tick & { at: number } => typeof tick.at === 'number');
  if (!ticks || ticks.length < 2) return null;
  const a = ticks[0]!;
  const b = ticks.find((tick) => tick.pos !== a.pos);
  if (!b) return null;
  const valueAt = (position: number) => a.at + ((position - a.pos) * (b.at - a.at)) / (b.pos - a.pos);
  const roundDomain = (value: number): number => Math.round(value * 1e9) / 1e9;
  const bounds = [valueAt(geometry.plot.y), valueAt(geometry.plot.y + geometry.plot.h)].map(roundDomain);
  return [Math.min(bounds[0]!, bounds[1]!), Math.max(bounds[0]!, bounds[1]!)];
}

/** Half the gap between the two strokes of the straight break glyph. */
const BREAK_HALF_SEPARATION = 2;

/**
 * A category break: the straight break glyph across a category baseline,
 * with the baseline knocked out between its strokes so the axis reads as cut.
 * `orient` names the baseline: 'x' horizontal (column), 'y' vertical (bar).
 * The strokes run at 60° to the horizontal, so they cross a horizontal line
 * 2/sin 60° from the centre and a vertical one 2/sin 30° from it.
 */
export function categoryBreakGlyph(theme: Theme, center: { x: number; y: number }, orient: 'x' | 'y', idPrefix: string): BreakGlyphResult {
  const glyph = straightBreakGlyph(theme, center, idPrefix, {}, { token: 'axis' }, 'categoryBreak');
  const half = BREAK_HALF_SEPARATION / Math.sin(orient === 'x' ? Math.PI / 3 : Math.PI / 6);
  const knockout: SceneNode = {
    t: 'line',
    id: `${idPrefix}:gap`,
    ...(orient === 'x'
      ? { x1: center.x - half, y1: center.y, x2: center.x + half, y2: center.y }
      : { x1: center.x, y1: center.y - half, x2: center.x, y2: center.y + half }),
    stroke: { token: 'background' },
    width: strokeToken(theme, 'casing'),
    owner: {},
    part: 'categoryBreak',
  };
  return { ...glyph, nodes: [knockout, ...glyph.nodes] };
}

/** Classic two-stroke straight-break glyph, centered on an axis or mark. */
export function straightBreakGlyph(
  theme: Theme,
  center: { x: number; y: number },
  idPrefix: string,
  owner: OwnerRef,
  stroke: Paint = { token: 'axis' },
  part = 'axisBreak',
): BreakGlyphResult {
  const halfLength = 5;
  const direction = { x: 0.5, y: -Math.sqrt(3) / 2 };
  const normal = { x: -direction.y, y: direction.x };
  const halfSeparation = BREAK_HALF_SEPARATION;
  const nodes: SceneNode[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [index, side] of [-1, 1].entries()) {
    const cx = center.x + normal.x * halfSeparation * side;
    const cy = center.y + normal.y * halfSeparation * side;
    const x1 = cx - direction.x * halfLength;
    const y1 = cy - direction.y * halfLength;
    const x2 = cx + direction.x * halfLength;
    const y2 = cy + direction.y * halfLength;
    xs.push(x1, x2);
    ys.push(y1, y2);
    nodes.push({
      t: 'line',
      id: `${idPrefix}:${index + 1}`,
      x1,
      y1,
      x2,
      y2,
      stroke,
      width: strokeToken(theme, 'rule'),
      owner,
      part,
    });
  }
  const pad = 1;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const rect = {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX + pad,
    h: Math.max(...ys) - minY + pad,
  };
  return { nodes, nodeIds: nodes.map((node) => node.id), rect };
}

/** Widest run of a bar cut along the value axis, so a wide column is not cut across a long stretch. */
const BAR_CUT_SPAN = 12;

/**
 * A straight value-axis break on a filled bar or column: one page-colour cut
 * of the old gap's width (2 × BREAK_HALF_SEPARATION) across the whole mark,
 * leaning 30° off square like the break glyph, at most BAR_CUT_SPAN px along
 * the value axis. The two parts of the mark meet under it. `axis` is the
 * value axis: 'x' for a bar, 'y' for a column.
 */
export function barBreakCut(mark: Rect, axis: 'x' | 'y', position: number, idPrefix: string, owner: OwnerRef): BreakGlyphResult {
  const thickness = axis === 'x' ? mark.h : mark.w;
  const lean = Math.min(thickness * Math.tan(Math.PI / 6), BAR_CUT_SPAN) / thickness;
  // Past both edges, so the square ends of the stroke still clear the mark's corners.
  const reach = thickness / 2 + 2;
  const [x1, y1, x2, y2] = axis === 'x'
    ? [position - reach * lean, mark.y + mark.h / 2 + reach, position + reach * lean, mark.y + mark.h / 2 - reach]
    : [mark.x + mark.w / 2 - reach, position + reach * lean, mark.x + mark.w / 2 + reach, position - reach * lean];
  const width = 2 * BREAK_HALF_SEPARATION;
  const node: SceneNode = { t: 'line', id: `${idPrefix}:cut`, x1, y1, x2, y2, stroke: { token: 'background' }, width, owner, part: 'barBreak' };
  const rect = {
    x: Math.min(x1, x2) - width / 2,
    y: Math.min(y1, y2) - width / 2,
    w: Math.abs(x2 - x1) + width,
    h: Math.abs(y2 - y1) + width,
  };
  return { nodes: [node], nodeIds: [node.id], rect };
}

/**
 * A value-axis break that a mark already shows as a cut is not drawn again on
 * the axis. The value axis draws no line, so its glyph would float beside the
 * cut as a second break. An axis glyph with no cut at its position (a break no
 * bar crosses, a line chart) stays. Each grid panel runs this on its own
 * layout; panels compare within their own offset.
 */
export function withoutRepeatedAxisBreaks(geometry: Pick<Geometry, 'scene' | 'axes'>): void {
  const centre = (node: Extract<SceneNode, { t: 'line' }>) => ({ x: (node.x1 + node.x2) / 2, y: (node.y1 + node.y2) / 2 });
  const panel = (node: SceneNode) => `${node.tx ?? 0},${node.ty ?? 0}`;
  if (!geometry.axes.some((axis) => axis.break !== undefined)) return;
  const cuts = geometry.scene.filter((node): node is Extract<SceneNode, { t: 'line' }> => node.t === 'line' && node.part === 'barBreak');
  if (cuts.length === 0) return;
  const drop = new Set<string>();
  for (const node of geometry.scene) {
    if (node.t !== 'line' || node.part !== 'axisBreak') continue;
    const orient = /axis:([xy]):break:\d+$/.exec(node.id)?.[1] as 'x' | 'y' | undefined;
    if (!orient) continue;
    const at = centre(node)[orient];
    if (cuts.some((cut) => panel(cut) === panel(node) && Math.abs(centre(cut)[orient] - at) <= 3)) drop.add(node.id);
  }
  if (drop.size === 0) return;
  geometry.scene = geometry.scene.filter((node) => !drop.has(node.id));
  for (const axis of geometry.axes) {
    if (axis.break) axis.break = { ...axis.break, nodeIds: axis.break.nodeIds.filter((id) => !drop.has(id)) };
  }
}

export function layoutValueAxis(input: ValueAxisInput, occupied: OccupiedIndex): ValueAxisResult {
  const { scale, plot, orient, theme, measure } = input;
  const font: FontSpec = secondaryFont(theme);
  const requestedTicks = input.ticks ?? scale.ticks(input.tickCount ?? 5);
  const nodes: SceneNode[] = [];
  const axis: AxisGeometry = { axis: orient === 'y' ? 'y' : 'x', ticks: [] };
  let reserved = 0;
  let seq = 0;
  const formatTick = input.formatSpec
    ? tickFormatter(input.formatSpec, requestedTicks)
    : input.format;
  // A bottom tick label centres on its tick. Only an end label whose centred
  // box would leave the canvas (a plot with no right margin) or run into
  // something already on it (the y-axis tick column beside a scatter's
  // corner) anchors inward, at its tick: an end label anchored by
  // default would sit 6 to 11 px off a tick at the plot edge.
  const labelX = (pos: number, width: number, index: number, count: number): number => {
    const centred = pos - width / 2;
    const end = count > 1 && (index === 0 || index === count - 1);
    if (!end) return centred;
    const box = { x: centred, y: plot.y + plot.h + 6, w: width, h: font.size * (font.lineHeight ?? 1.2) };
    const inside = centred >= 0 && centred + width <= (input.canvasWidth ?? Infinity);
    return inside && occupied.hitsWhich(box, 0).length === 0 ? centred : tickLabelX(pos, width, index, count, true);
  };
  const ticks = thinAxisTicks(requestedTicks, scale, orient, formatTick, font, measure, labelX, input.keepEndTicks === true);

  for (const t of ticks) {
    const pos = scale(t);
    const text = formatTick(t);
    const tsize = measure(text, font);
    const gridId = input.gridlines && t !== 0 ? `axis:${orient}:grid:${seq}` : undefined;

    if (orient === 'y') {
      if (gridId) {
        nodes.push({
          t: 'line', id: gridId, x1: plot.x, y1: pos, x2: plot.x + plot.w, y2: pos,
          stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), ...gridDash(theme), owner: {}, part: 'gridline',
        });
      }
      const labelRect: Rect = {
        x: plot.x - tsize.width - 8,
        y: pos - tsize.height / 2,
        w: tsize.width,
        h: tsize.height,
      };
      const labelId = `axis:${orient}:tick:${seq}`;
      nodes.push({
        t: 'text', id: labelId, x: labelRect.x, y: labelRect.y, lines: [text],
        align: 'start', font, ink: { token: 'inkMuted' }, owner: {}, part: 'tick', typeRole: 'secondary',
      });
      occupied.claim(labelRect, 'axis', {});
      reserved = Math.max(reserved, tsize.width + 8);
      axis.ticks.push({ at: t, pos, labelId, gridNodeId: gridId });
    } else {
      if (gridId) {
        nodes.push({
          t: 'line', id: gridId, x1: pos, y1: plot.y, x2: pos, y2: plot.y + plot.h,
          stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), ...gridDash(theme), owner: {}, part: 'gridline',
        });
      }
      const labelRect: Rect = {
        x: labelX(pos, tsize.width, seq, ticks.length),
        y: plot.y + plot.h + 6,
        w: tsize.width,
        h: tsize.height,
      };
      const labelId = `axis:${orient}:tick:${seq}`;
      nodes.push({
        t: 'text', id: labelId, x: labelRect.x, y: labelRect.y, lines: [text],
        align: 'start', font, ink: { token: 'inkMuted' }, owner: {}, part: 'tick', typeRole: 'secondary',
      });
      occupied.claim(labelRect, 'axis', {});
      reserved = Math.max(reserved, tsize.height + 6);
      axis.ticks.push({ at: t, pos, labelId, gridNodeId: gridId });
    }
    seq++;
  }

  if (scale.break) {
    const center =
      orient === 'y'
        ? { x: plot.x, y: scale.break.position }
        : { x: scale.break.position, y: plot.y + plot.h };
    const glyph = straightBreakGlyph(theme, center, `axis:${orient}:break`, {}, { token: 'axis' });
    nodes.push(...glyph.nodes);
    occupied.claim(glyph.rect, 'axis', {}, 'axisBreak');
    axis.break = { rect: glyph.rect, style: 'straight', nodeIds: glyph.nodeIds };
  }
  // The tick label column is one block. A data value between
  // two tick labels reads as a tick (19, 19, 22 among 0, 50, 100).
  if (orient === 'y' && reserved > 8) (occupied.tickColumns ??= []).push({ x: plot.x - reserved, y: plot.y, w: reserved - 8, h: plot.h });

  return { nodes, axis, reserved };
}

/** Clear air between a value-axis title and the tick labels next to it. */
export const AXIS_TITLE_GAP = 4;

/** A value-axis title as it will be drawn: one line, cut with an ellipsis. */
export interface ValueAxisTitle {
  /** The full title; the node carries it as `<title>` when the line is cut. */
  text: string;
  /** The first line; `lines` holds every line of a title planned to wrap. */
  line: string;
  lines: string[];
  truncated: boolean;
  font: FontSpec;
  width: number;
  height: number;
}

/**
 * The "Measure, unit" title of a value axis. An authored
 * title wins. A theme that sets `valueAxis.titles` derives one from the
 * subtitle's measure and the axis unit, written as authored, once. The
 * derived title only adds what the drawn subtitle does not say: the
 * subtitle prints the measure, and beside it the chart unit ("Product sales
 * in $m"), so the title is derived only for an axis unit the chrome does
 * not print (a unit the series share, the % of a 100% axis). Under the
 * engine's own chrome "Sales, $m" under "Product sales in $m" is a repeat.
 */
export function valueAxisTitleText(
  theme: Theme,
  authored: string | undefined,
  chrome: Pick<BaseOptions, 'subtitle' | 'unit' | 'unitShown'>,
  unit: string | undefined,
): string | undefined {
  if (authored) return authored;
  if (theme.valueAxis?.titles !== true) return undefined;
  const subtitle = resolveSubtitle(chrome.subtitle);
  const measureName = subtitle?.measure?.trim();
  if (!measureName || !unit) return undefined;
  if (unit === chrome.unit && unitPrinted({ subtitle, unit: chrome.unit, unitShown: chrome.unitShown })) return undefined;
  return `${measureName}, ${unit}`;
}

/**
 * The unit a value-axis title names: % on an axis of shares (a
 * 100 % composition), else the chart unit, else the one unit every data
 * series shares. Reference series do not define the plotted measure and
 * are left out by the caller.
 */
export function valueAxisUnit(
  chartUnit: string | undefined,
  dataSeries: readonly { unit?: string }[],
  shares: boolean,
): string | undefined {
  if (shares) return '%';
  if (chartUnit) return chartUnit;
  const units = new Set(dataSeries.map((series) => series.unit));
  return units.size === 1 ? [...units][0] : undefined;
}

/** Whether a chart's label map lets the value-axis title draw (`labels.axisTitle`, `labels: false`). */
export function axisTitleAllowed(labels: BaseOptions['labels']): boolean {
  return labels !== false && labels?.axisTitle !== false;
}

/**
 * The axis role at its regular weight, at most `maxWidth` wide on up to
 * `maxLines` lines (two by default): a caption wraps before it is cut
 * (the mekko width caption, the histogram method row). Every
 * caller reserves the measured `height`; a wrapped title never sits in a
 * tick row (tickRowTitleEnd).
 */
export function planValueAxisTitle(
  text: string | undefined,
  theme: Theme,
  measure: TextMeasurer,
  maxWidth: number,
  maxLines = 2,
): ValueAxisTitle | undefined {
  if (!text) return undefined;
  const font: FontSpec = secondaryFont(theme);
  const wrapped = wrapText(text, font, Math.max(1, maxWidth), maxLines, measure);
  const lines = wrapped.lines.length > 0 ? wrapped.lines : [text];
  const sizes = lines.map((line) => measure(line, font));
  return { text, line: lines[0]!, lines, truncated: wrapped.truncated, font,
    width: Math.max(...sizes.map((size) => size.width)), height: sizes.reduce((sum, size) => sum + size.height, 0) };
}

/**
 * The band a title over a left value axis adds on top of the plot's 8px head
 * pad: the title, its gap and the half of the top tick label that rises above
 * the plot. The title is drawn at the top of the band, so it clears that
 * label by AXIS_TITLE_GAP. `rowsBelow` is the height of the header rows
 * (forecast header, CAGR arm) between the title and the plot: the tick label
 * rises into them at the axis, left of anything they draw, so the band adds
 * only the part of the half label they do not already span.
 */
export function valueAxisTitleBand(title: ValueAxisTitle | undefined, theme: Theme, measure: TextMeasurer, rowsBelow = 0): number {
  if (!title) return 0;
  const tickHalf = measure('0', secondaryFont(theme)).height / 2;
  return title.height + Math.max(0, tickHalf - rowsBelow);
}

/**
 * A value-axis title as a label request: one seat, start- or
 * end-anchored at x, solved with the chart's other labels at the grand-total
 * priority, so it claims its box before any value label and is published in
 * `geometry.labels`. The axis role at its regular weight rides as the label's font;
 * `applyValueAxisTitleInk` sets the muted ink once the solver has placed it.
 */
export function valueAxisTitleRequest(
  title: ValueAxisTitle,
  at: { x: number; y: number },
  align: 'start' | 'end',
  id: string,
): LabelRequest {
  const rect: Rect = { x: align === 'end' ? at.x - title.width : at.x, y: at.y, w: title.width, h: title.height };
  return {
    id, kind: 'axisTitle', typeRole: 'secondary', owner: {}, text: title.text, lines: title.lines, font: title.font, fontStep: title.font,
    priority: PRIORITY.grandTotal,
    ...(title.truncated ? { title: title.text } : {}),
    candidates: [{ slot: 'axisTitle', rect, penalty: 0 }],
  };
}

/** From a bottom axis title to the tick label beside it in the same row. */
const TICK_ROW_TITLE_GAP = 12;

/**
 * Where the title of a bottom value axis fits in the tick-label row, so it
 * takes no row of its own: right-aligned at the plot's right end, past the
 * last tick label, or right-aligned short of the first, no further left than
 * `left`. The axis is laid out on a scratch index, as `layoutValueAxis` will
 * lay it out, to read its tick labels. Undefined when neither side has room.
 */
export function tickRowTitleEnd(title: ValueAxisTitle, axis: ValueAxisInput, left: number): number | undefined {
  // A wrapped title takes its own row under the ticks; the tick row holds one line.
  if (title.lines.length > 1) return undefined;
  const font: FontSpec = secondaryFont(axis.theme);
  const labels = layoutValueAxis(axis, createOccupiedIndex({ x: 0, y: 0, w: Number.MAX_VALUE, h: Number.MAX_VALUE })).nodes
    .flatMap((node) => (node.t === 'text' && node.part === 'tick' ? [{ x: node.x, w: axis.measure(node.lines[0] ?? '', font).width }] : []));
  const end = axis.plot.x + axis.plot.w;
  const lastRight = Math.max(-Infinity, maxOf(labels.map((label) => label.x + label.w)));
  if (end - title.width >= lastRight + TICK_ROW_TITLE_GAP) return end;
  const firstLeft = Math.min(end, minOf(labels.map((label) => label.x))) - TICK_ROW_TITLE_GAP;
  return firstLeft - title.width >= left ? firstLeft : undefined;
}

/** The ids `valueAxisTitleRequest` gives a line, column or bar title. */
const VALUE_AXIS_TITLE_IDS = new Set(['axis:y:title', 'axis:x:title']);

/** A placed value-axis title takes the muted ink. */
export function applyValueAxisTitleInk(labels: PlacedLabel[]): void {
  for (const label of labels) if (label.kind === 'axisTitle' && VALUE_AXIS_TITLE_IDS.has(label.id)) label.ink = { token: 'inkMuted' };
}

/**
 * Measure the space a y-axis will need BEFORE the plot rect is final —
 * call with the domain, shrink the plot, then lay out with the real scale.
 */
export function measureValueAxisWidth(
  domain: [number, number],
  format: (v: number) => string,
  theme: Theme,
  measure: TextMeasurer,
  tickCount = 5,
  formatSpec?: NumberFormatSpec,
  explicitTicks?: readonly number[],
): number {
  const font: FontSpec = secondaryFont(theme);
  const ticks = explicitTicks ? [...explicitTicks] : linearScale(domain, [0, 1]).ticks(tickCount);
  const fmt = formatSpec ? tickFormatter(formatSpec, ticks) : format;
  const values = explicitTicks ? ticks : [...ticks, ...domain];
  const w = maxOf(values.map((value) => measure(fmt(value), font).width));
  return w + 8;
}
