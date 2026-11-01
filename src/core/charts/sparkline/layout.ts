import { SPARK_LABEL_SHARE } from './share';
import { chartString } from '../../strings/sparkline';
import { structureCount } from '../../structureCounts';
/**
 * Sparkline geometry, shared by the KPI card, the table encoding cell and
 * the standalone `sparkline` chart at the bottom of this file. Shape-only:
 * no axes, grid, or invented markers. Layout owns positions; renderers paint
 * the returned nodes.
 */

import { cutWithTitle } from '../../label/fitText';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { authoredNotes, frameTextOptions, plotHeightAfter, solveFrame } from '../../frame';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { bandScale, linearScale } from '../../scale';
import { chartSizing, resolveSizing } from '../../sizing';
import { linePath } from '../../svgPath';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  microType,
  panelTypeClass,
  themeForWidth,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  strokeToken,
  dashToken,
} from '../../theme';
import { readerFloorPx, textScaleOf } from '../../typeFloors';
import { cellMeta, cellValue, type Cell, type Id, type OwnerRef } from '../../types/cell';
import type { SparklineData } from '../../types/data';
import type { CanvasSizeInput, RenderTarget, SparklineOptions } from '../../types/options';
import { DEFAULT_TARGET, resolveTargetSize, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import type { Geometry, LintWarning, Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { normalizeCell } from '../../normalize/shared';
import { ringToneRefusal } from './refusals';
import { pushAll } from '../../arrays';

/**
 * the registry gives an unsized chart its target's default width
 * (720 px under report). A card (kpi, bullet, sparkline) keeps its own
 * default width instead, as it keeps its width-class exemption, and the
 * height the fit layer measured for it.
 */
export function cardSize(options: { size?: CanvasSizeInput } & TargetSizeOptions, fallback: { width: number; height: number }): CanvasSizeInput {
  if (options.size === undefined || options[TARGET_SIZE]?.fixed.width !== false) return options.size ?? fallback;
  return { width: fallback.width, height: resolveSize(options.size).height };
}

/**
 * The bullet card skips the width classes for its own marks, but its title
 * and subtitle follow the size ladder of every other chart: 17/13 px under
 * 720 px on report. kpi and sparkline keep 20/14 at every width.
 */
export function cardFrameTheme(theme: Theme, options: { target?: RenderTarget }, width: number): Theme {
  const stepped = themeForWidth(theme, panelTypeClass(options) ?? width).type;
  if (stepped.title.size === theme.type.title.size && stepped.subtitle.size === theme.type.subtitle.size) return theme;
  return {
    ...theme,
    type: {
      ...theme.type,
      title: { ...theme.type.title, size: stepped.title.size },
      subtitle: { ...theme.type.subtitle, size: stepped.subtitle.size },
    },
  };
}

/** The side margin of a framed sparkline on a render target (28 px at every width). */
const FRAMED_SIDE_MARGIN = 28;
/**
 * The width of a framed sparkline that authors none. At the 176 px of a bare tile its title, subtitle and source
 * wrap word by word, the line is a tenth of the canvas and the two end names touch.
 */
const FRAMED_DEFAULT_WIDTH = 320;
/** From this width a framed card draws the scaled line band on every target, the dashboard tile included. */
const FRAMED_BAND_MIN_WIDTH = 320;

type SparklineShape = 'line' | 'column' | 'area';
export type TableSparklineShape = 'line' | 'column';

export interface SparklineDomain {
  min: number;
  max: number;
}

export interface SparklineStyle {
  padding: number;
  strokeWidth?: number;
  dotRadius: number;
}

export const TABLE_SPARK_STYLE: SparklineStyle = { padding: 8, dotRadius: 2 };
const KPI_SPARK_STYLE: SparklineStyle = { padding: 3, dotRadius: 2.5 };

/** A spark's style under its theme: a ring at the last point needs its own reach inside the box. */
export function sparkStyle(theme: Theme, style: SparklineStyle): SparklineStyle {
  if (theme.marks?.sparkEnd !== 'ring') return style;
  return { ...style, padding: Math.max(style.padding, SPARKLINE_RING_RADIUS + strokeToken(theme, 'mark') / 2) };
}

const LABEL_GAP = 4;
const COLUMN_INNER = 0.28;
const COLUMN_OUTER = 0.08;

export function lastObservedIndex(values: readonly (number | null)[]): number | undefined {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] !== null) return index;
  }
  return undefined;
}

/**
 * CellMeta.label convention shared by the chart families: false drops the text,
 * a string replaces the formatted value and may place it with a ${value} slot.
 */
function cellLabelText(label: string | false | undefined, formatted: string): string | undefined {
  if (label === false) return undefined;
  return typeof label === 'string' ? label.replace(/\$\{value\}/g, formatted) : formatted;
}

/** CellMeta.label of the last observed cell; trailing nulls are skipped. */
export function lastObservedLabel(cells: readonly Cell[]): string | false | undefined {
  const index = lastObservedIndex(cells.map((cell) => cellValue(cell)));
  return index === undefined ? undefined : cellMeta(cells[index]!)?.label;
}

/**
 * Last observed cell priority, trailing nulls skipped, so an authored
 * CellMeta.priority reaches the endpoint label request.
 */
export function lastObservedPriority(cells: readonly Cell[]): number | undefined {
  const index = lastObservedIndex(cells.map((cell) => cellValue(cell)));
  return index === undefined ? undefined : cellMeta(cells[index]!)?.priority;
}

/**
 * Pixel mapping for a domain whose span the double range cannot represent.
 * `linearScale` divides by max - min, and opposite-sign finite extremes such as
 * -MAX_VALUE and MAX_VALUE subtract to Infinity: the far endpoint then divides
 * Infinity by Infinity and the path data carries NaN. Scaling both ends by the
 * larger magnitude first keeps the ratio finite. Spans that subtract normally
 * never reach this function, so ordinary output is unchanged.
 */
function overflowSpanY(domain: SparklineDomain, plot: Rect, value: number): number {
  const scale = Math.max(Math.abs(domain.min), Math.abs(domain.max));
  const lo = domain.min / scale;
  const hi = domain.max / scale;
  const span = hi - lo;
  if (!(span > 0)) return plot.y + plot.h;
  return plot.y + plot.h - ((value / scale - lo) / span) * plot.h;
}

export function sparklineDomain(
  series: readonly (readonly (number | null)[])[],
  shape: SparklineShape,
): SparklineDomain {
  let min = Infinity;
  let max = -Infinity;
  for (const values of series) {
    for (const value of values) {
      if (value === null) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0 };
  // A column and an area spark encode a value as a height from zero: a
  // floor at the series minimum would draw the first point with no height
  // and read as growth from nothing. A line spark keeps its min-max range.
  if (shape === 'column' || shape === 'area') {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  return { min, max };
}

interface SparklinePlot {
  plot: Rect;
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  runs: { x: number; y: number }[][];
  columns: { index: number; value: number; rect: Rect; last: boolean }[];
  last?: { index: number; value: number; x: number; y: number };
  label?: { x: number; y: number; w: number; h: number; text: string; font: FontSpec; title?: string };
  /**
   * Where each null sits. A line gap between two observed points carries
   * the bridge's ends and its ring sits on the bridge; a column gap and a
   * line gap at either end sit on the zero line or the plot's foot.
   */
  gaps: { index: number; x: number; y: number; bridge?: [{ x: number; y: number }, { x: number; y: number }] }[];
}

export function plotSparkline(input: {
  box: Rect;
  values: readonly (number | null)[];
  shape: SparklineShape;
  domain: SparklineDomain;
  style: SparklineStyle;
  lastText?: string;
  font?: FontSpec;
  measure?: TextMeasurer;
}): SparklinePlot {
  const { box, values, domain, style } = input;
  const measure = input.measure ?? defaultMeasurer;
  const n = values.length;
  let label: SparklinePlot['label'];
  let labelReserve = 0;
  if (input.lastText && input.font) {
    const maxLabel = Math.max(12, box.w * SPARK_LABEL_SHARE);
    const cut = cutWithTitle(input.lastText, input.font, maxLabel, measure);
    const text = cut.text;
    const size = measure(text, input.font);
    labelReserve = size.width + LABEL_GAP;
    label = {
      x: box.x + box.w - style.padding,
      y: box.y + (box.h - size.height) / 2,
      w: size.width,
      h: size.height,
      text,
      font: input.font,
      ...(cut.title !== undefined ? { title: cut.title } : {}),
    };
  }

  const plot: Rect = {
    x: box.x + style.padding,
    y: box.y + style.padding,
    w: Math.max(0, box.w - 2 * style.padding - labelReserve),
    h: Math.max(0, box.h - 2 * style.padding),
  };
  const yScale = linearScale([domain.min, domain.max], [plot.y + plot.h, plot.y]);
  // A span the double range cannot represent (opposite-sign finite extremes)
  // is the one case linearScale answers NaN for; it takes the stable route.
  const overflowingSpan = !Number.isFinite(domain.max - domain.min);
  const xAt = (index: number) =>
    n <= 1 ? plot.x + plot.w / 2 : plot.x + (index / Math.max(1, n - 1)) * plot.w;
  const yAt = (value: number) =>
    domain.max === domain.min
      ? box.y + box.h / 2
      : overflowingSpan
        ? overflowSpanY(domain, plot, value)
        : yScale(value);

  const lastIndex = lastObservedIndex(values);
  const last =
    lastIndex === undefined
      ? undefined
      : { index: lastIndex, value: values[lastIndex]!, x: xAt(lastIndex), y: yAt(values[lastIndex]!) };

  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: xAt(index), y: yAt(value) });
  });
  if (run.length > 0) runs.push(run);

  const columns: SparklinePlot['columns'] = [];
  if (input.shape === 'column' && n > 0) {
    const bands = bandScale(n, [plot.x, plot.x + plot.w], { paddingInner: COLUMN_INNER, paddingOuter: COLUMN_OUTER });
    const zeroY = yAt(0);
    values.forEach((value, index) => {
      if (value === null) return;
      const y = yAt(value);
      columns.push({
        index,
        value,
        last: index === lastIndex,
        rect: {
          x: bands.position(index),
          y: Math.min(zeroY, y),
          w: bands.bandwidth,
          h: Math.abs(y - zeroY),
        },
      });
    });
  }

  const gaps: SparklinePlot['gaps'] = [];
  const observed = values.flatMap((value, index) => (value === null ? [] : [index]));
  if (observed.length > 0) {
    const foot = input.shape !== 'line' ? yAt(Math.max(domain.min, Math.min(0, domain.max))) : plot.y + plot.h;
    const bands = input.shape === 'column' && n > 0
      ? bandScale(n, [plot.x, plot.x + plot.w], { paddingInner: COLUMN_INNER, paddingOuter: COLUMN_OUTER }) : undefined;
    values.forEach((value, index) => {
      if (value !== null) return;
      const x = bands ? bands.position(index) + bands.bandwidth / 2 : xAt(index);
      const before = observed.filter((i) => i < index).at(-1);
      const after = observed.find((i) => i > index);
      if (bands || before === undefined || after === undefined) {
        gaps.push({ index, x, y: foot });
        return;
      }
      const a = { x: xAt(before), y: yAt(values[before]!) };
      const b = { x: xAt(after), y: yAt(values[after]!) };
      gaps.push({ index, x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x), bridge: [a, b] });
    });
  }

  return { plot, xAt, yAt, runs, columns, last, label, gaps };
}

/**
 * As the line chart marks a gap, a line spark bridges a null
 * with a dashed segment and rings the missing point on it, so the gap is
 * seen and the bridge is not read as measured; a column spark rings its
 * empty slot on the zero line. Each ring names itself as "no value".
 */
function sparkGapNodes(theme: Theme, plot: SparklinePlot, paint: Paint, nodeId: (suffix: string) => Id, owner: (index: number) => OwnerRef, part: string): SceneNode[] {
  const nodes: SceneNode[] = [];
  const bridged = new Set<number>();
  for (const gap of plot.gaps) {
    if (gap.bridge && !bridged.has(gap.bridge[0].x)) {
      bridged.add(gap.bridge[0].x);
      nodes.push({ t: 'path', id: nodeId(`gapBridge:${gap.index}`), d: linePath(gap.bridge), stroke: paint, width: strokeToken(theme, 'data'), dash: dashToken(theme, 'dotted'), lineCap: 'round' as const, owner: owner(gap.index), part: `${part}Bridge` });
    }
    nodes.push({
      t: 'circle', id: nodeId(`gap:${gap.index}`), cx: gap.x, cy: gap.y, r: GAP_RING_RADIUS,
      fill: { token: 'background' }, stroke: paint, strokeWidth: strokeToken(theme, 'hair'), owner: owner(gap.index), part,
      display: { value: 'no value', state: 'missing' },
    });
  }
  return nodes;
}

/** Radius of the hollow ring that marks a null in a spark. */
const GAP_RING_RADIUS = 2.5;

export function emitSparklineMarks(input: {
  plot: SparklinePlot;
  shape: SparklineShape;
  theme: Theme;
  palette?: string;
  style: SparklineStyle;
  nodeId: (suffix: string) => Id;
  owner: OwnerRef;
  partPrefix: 'table' | 'kpi';
  /** The last point's paint; absent keeps the spark's accent. */
  lastPaint?: Paint;
}): SceneNode[] {
  const { plot, shape, theme, palette, style, nodeId, owner, partPrefix } = input;
  const nodes: SceneNode[] = [];
  // The line takes `color.spark`, which falls back to the neutral.
  // The neutral is a fill: a theme whose neutral is a pale band drew a line
  // a reader could barely see, and that theme points the spark at its ink.
  // A column spark's columns are marks in the neutral: the neutral mark role.
  const lineStroke = semanticPalettePaint(theme, palette, 'spark');
  const columnFill = semanticPalettePaint(theme, palette, 'neutralMark');
  const lastFill = input.lastPaint ?? semanticPalettePaint(theme, palette, 'highlight');

  // The wash under an area spark is a whole mark, not a single accent: it
  // takes `color.focus`, which falls back to the highlight, and only the last
  // point keeps the highlight. A theme whose highlight is a point accent (a
  // latest-point ring) would otherwise fill the whole spark in it. A theme
  // that sets `surface.sparkWash: false` draws no wash at all: the
  // spark is its line and last point, as a line spark is.
  if (shape === 'area' && theme.surface?.sparkWash !== false) {
    // The wash fills to the zero line, which the zero-floor domain keeps
    // inside the plot: a series below zero fills up to it, as columns do.
    // `surface.sparkAreaBase: 'min'` fills to the plot's foot.
    const foot = plot.plot.y + plot.plot.h;
    const base = theme.surface?.sparkAreaBase === 'min' ? foot : Math.min(foot, Math.max(plot.plot.y, plot.yAt(0)));
    const areaD = plot.runs
      .filter((points) => points.length > 1)
      .map((points) => `${linePath([...points, { x: points[points.length - 1]!.x, y: base }, { x: points[0]!.x, y: base }])}Z`)
      .join('');
    if (areaD) {
      nodes.push({
        t: 'path',
        id: nodeId(partPrefix === 'kpi' ? 'spark:fill' : 'sparkFill'),
        d: areaD,
        fill: semanticPalettePaint(theme, palette, 'focus', 0.88),
        stroke: semanticPalettePaint(theme, palette, 'focus'),
        width: strokeToken(theme, 'mark'),
        owner,
        part: partPrefix === 'kpi' ? 'spark' : 'tableSparkFill',
      });
    }
  }

  if (shape === 'column') {
    for (const column of plot.columns) {
      if (column.rect.h <= 0 || column.rect.w <= 0) continue;
      nodes.push({
        t: 'rect',
        id: nodeId(column.last ? 'sparkColLast' : `sparkCol:${column.index}`),
        rect: column.rect,
        fill: column.last ? lastFill : columnFill,
        owner,
        part: partPrefix === 'kpi' ? 'spark' : 'tableSparkColumn',
      });
    }
  } else {
    const d = plot.runs.filter((points) => points.length > 1).map((points) => linePath(points)).join('');
    if (d) {
      nodes.push({
        t: 'path',
        id: nodeId(partPrefix === 'kpi' ? 'spark' : 'sparkline'),
        d,
        stroke: lineStroke,
        width: style.strokeWidth ?? strokeToken(theme, 'mark'),
        owner,
        part: partPrefix === 'kpi' ? 'spark' : 'tableSparkline',
      });
    }
  }

  pushAll(nodes, sparkGapNodes(theme, plot, shape === 'column' ? columnFill : lineStroke, (suffix) => nodeId(suffix), () => owner,
    partPrefix === 'kpi' ? 'sparkGap' : 'tableSparkGap'));

  if (plot.last && shape !== 'column') {
    // A theme's `marks.sparkEnd: 'ring'` draws the standalone
    // sparkline's ring instead of the filled point.
    const ring = theme.marks?.sparkEnd === 'ring';
    nodes.push({
      t: 'circle',
      id: nodeId(partPrefix === 'kpi' ? 'spark:dot' : 'sparkDot'),
      cx: plot.last.x,
      cy: plot.last.y,
      ...(ring
        ? { r: SPARKLINE_RING_RADIUS, fill: { token: 'background' as const }, stroke: lastFill, strokeWidth: strokeToken(theme, 'mark') }
        : { r: style.dotRadius, fill: lastFill }),
      owner,
      part: partPrefix === 'kpi' ? 'sparkDot' : 'tableSparkDot',
    });
  }

  if (plot.label && partPrefix === 'table') {
    nodes.push({
      t: 'text',
      id: nodeId('sparkLast'),
      x: plot.label.x,
      y: plot.label.y,
      lines: [plot.label.text],
      ...(plot.label.title !== undefined ? { title: plot.label.title } : {}),
      align: 'end',
      font: plot.label.font,
      ink: { token: 'ink' },
      owner,
      part: 'tableSparkLast',
      typeRole: 'label',
      display: { value: plot.label.text },
    });
  }
  return nodes;
}

/** The row the first and last period names take under a kpi spark, with its gap. */
export function kpiSparkPeriodRowHeight(theme: Theme): number {
  return theme.type.axis.size * 1.3 + END_LABEL_GAP;
}

export function emitKpiSpark(
  nodes: SceneNode[],
  rect: Rect,
  kind: SparklineShape,
  values: readonly (number | null)[],
  theme: Theme,
  palette: string | undefined,
  format: (value: number) => string,
  measure: TextMeasurer,
  requests: LabelRequest[],
  /** CellMeta.label of the last observed cell; false is the labels-off gate. */
  endpointLabel?: string | false,
  /** CellMeta.priority of the last observed cell; absent keeps the endpoint band. */
  endpointPriority?: number,
  /** CellMeta.format of the last observed cell; overrides the card format. */
  endpointFormat?: string,
  card: {
    /** The card's own figure: an end label reading the same number is not printed twice. */
    heroText?: string;
    /** One period name per value; the first and the last print under the spark's ends. */
    periods?: readonly string[];
    /** The chart locale, for the endpoint's own format example. */
    locale?: string;
  } = {},
): Id | undefined {
  const lastIndex = lastObservedIndex(values);
  // The cell's own format example wins over the card's before ${value} is
  // interpolated into a custom label, matching the cell-format override the
  // other chart families apply (bar/dot/heatmap).
  const lastFormat = endpointFormat ? formatterFromExample(endpointFormat, card.locale) : format;
  // A theme's `marks.sparkEndLabel: false` leaves the last value to the card's figure.
  const endText = lastIndex === undefined || theme.marks?.sparkEndLabel === false
    ? undefined : cellLabelText(endpointLabel, lastFormat(values[lastIndex]!));
  const lastText = endText === card.heroText ? undefined : endText;
  const font: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const first = card.periods?.[0];
  const last = card.periods?.at(-1);
  const periodH = first || last ? font.size * 1.3 : 0;
  const lineBox = periodH ? { ...rect, h: Math.max(0, rect.h - kpiSparkPeriodRowHeight(theme)) } : rect;
  const periodY = rect.y + rect.h - periodH;
  for (const [id, text, align] of [['spark:period:first', first, 'start'], ['spark:period:last', last, 'end']] as const) {
    if (!text || (id === 'spark:period:last' && values.length < 2)) continue;
    const width = measure(text, font).width;
    requests.push({
      id,
      kind: 'point',
      pad: 0,
      role: 'category',
      typeRole: 'axis',
      owner: { seriesId: 'spark', segmentId: id === 'spark:period:first' ? 'sparkFirst' : 'sparkLast' },
      text,
      lines: [text],
      font,
      priority: PRIORITY.endpoint,
      candidates: [{ slot: 'end', rect: { x: align === 'start' ? rect.x : rect.x + rect.w - width, y: periodY, w: width, h: periodH }, penalty: 0 }],
    });
  }
  // A theme that draws no wash draws an area spark as a line, and a line
  // keeps its min-max range. A theme with `surface.sparkAreaBase: 'min'`
  // keeps that range under the wash too.
  const areaFromMin = kind === 'area' && (theme.surface?.sparkWash === false || theme.surface?.sparkAreaBase === 'min');
  const domain = sparklineDomain([values], areaFromMin ? 'line' : kind);
  const plot = plotSparkline({
    box: lineBox,
    values,
    shape: areaFromMin ? 'line' : kind,
    domain,
    style: sparkStyle(theme, KPI_SPARK_STYLE),
    lastText,
    font,
    measure,
  });
  const owner = { seriesId: 'spark' };
  const markNodes = emitSparklineMarks({
    plot,
    shape: kind,
    theme,
    palette,
    style: KPI_SPARK_STYLE,
    nodeId: (suffix) => `mark:${suffix}`,
    owner,
    partPrefix: 'kpi',
  });
  pushAll(nodes, markNodes);
  if (plot.label) {
    requests.push({
      id: 'spark:last',
      kind: 'point',
      pad: 0,
      typeRole: 'label',
      owner: { seriesId: 'spark', segmentId: 'sparkLast' },
      text: plot.label.text,
      lines: [plot.label.text],
      ...(plot.label.title !== undefined ? { title: plot.label.title } : {}),
      font,
      priority: endpointPriority ?? PRIORITY.endpoint,
      candidates: [{ slot: 'sparkLast', rect: { x: plot.label.x - plot.label.w, y: plot.label.y, w: plot.label.w, h: plot.label.h }, penalty: 0 }],
    });
  }
  const primary = markNodes.find((node) => node.part === 'spark' && node.t !== 'circle');
  // All-zero columns emit no mark, so they have no mark id to publish.
  return primary?.id ?? markNodes[0]?.id;
}

/**
 * Normalized spark cells and their numeric values from one normalization pass.
 * The cells keep CellMeta (label, format, priority) for the endpoint label.
 */
export function kpiSparkSeries(spark: { values: readonly Cell[] } | undefined): {
  cells: readonly Cell[];
  values: (number | null)[];
} {
  const cells = (spark?.values ?? []).map((cell, index) => normalizeCell(cell, `spark.values[${index}]`));
  return { cells, values: cells.map((cell) => cellValue(cell)) };
}

// ---------------------------------------------------------------------------
// The standalone `sparkline` chart
// ---------------------------------------------------------------------------

/**
 * The standard sparkline: 176 by 36, one line at 1.5 px in the
 * ink, a ring on the last observed point in the highlight, and nothing else
 * — no axes, no grid, no smoothing, no area fill. It exists as a type of its
 * own because a card, a strip and a table row all want the same mark, and
 * every host was drawing its own.
 */
const SPARKLINE_SIZE = { width: 176, height: 36 } as const;
/** Radius and stroke of the endpoint ring, the table hover card's own pair. */
export const SPARKLINE_RING_RADIUS = 3.2;
/** Radius of an isolated point, independent of the line width. */
const SPARKLINE_POINT_RADIUS = 1.5;
/** Air between the line and the end labels under it. */
const END_LABEL_GAP = 2;
/** The height a framed trend reads at under a render target, the KPI spark's floor. */
const SPARK_TREND_MIN = 24;
/**
 * The vertical span a bare sparkline with end labels must keep, on every
 * target. The ring padding sits inside the line room, so the room floor is
 * this span plus that padding. A fixed 14 px of room, from a 6 px padding
 * estimate, still draws a 6.1 px line.
 */
const SPARK_BARE_END_LABEL_SPAN = 8;
/**
 * A framed exhibit's line band grows with the card width:
 * about 46 px plus a tenth of the width, 78 px at 320 and 142 px at 960, so
 * the climb keeps its slope on a wide card. Never under 70 px, never over 200.
 */
const framedBand = (width: number) => Math.min(200, Math.max(70, Math.round(46 + width / 10)));
/** Extra air under a framed line before the period names. */
const FRAMED_END_LABEL_AIR = 4;
/** Air between the end ring and the last value. */
const VALUE_LABEL_GAP = 6;
/** The band a framed line keeps under its high-point label. */
const HIGH_POINT_MIN_BAND = 60;

/** One drawn point: its identity, its position and the text it reads as. */
interface SparklinePoint {
  id: Id;
  index: number;
  x: number;
  y: number;
  /** The authored label, where the series carries one. */
  label?: string;
}

export interface SparklineMarks {
  /** The box the line is drawn in. */
  plot: Rect;
  /** One entry per observed value, in source order. */
  points: SparklinePoint[];
  /** The last observed point, where the ring sits. */
  last?: SparklinePoint;
}

export interface SparklineDerived {
  count: number;
  first: number | null;
  last: number | null;
  domain: SparklineDomain;
}

/**
 * The name a point carries: its POSITION, never its label. Twelve
 * months of two years repeat "Jan", and a label-based identity made every
 * duplicate resolve to the last one drawn, so the hover of the first
 * January read the second January's value. The label rides beside the identity, on
 * the mark, on the record and in `data-bp-category-label`.
 */
export function sparklinePointId(index: number): Id {
  return `p${index + 1}`;
}

/**
 * The card of a framed sparkline whose width is not authored: wide enough for its title on one line
 * between the two side margins, never under 320 px and never over the target's canvas.
 * A longer title wraps as on any chart. A sized sparkline keeps the size it was given.
 */
function framedCardSize(options: SparklineOptions, theme: Theme, measure: TextMeasurer): { width: number; height: number } {
  const card = resolveSize(cardSize(options, SPARKLINE_SIZE));
  const constraints = (options as SparklineOptions & TargetSizeOptions)[TARGET_SIZE];
  if (options.size !== undefined && constraints?.fixed.width !== false) return card;
  const canvas = resolveTargetSize(options.target ?? DEFAULT_TARGET).sizePx.width;
  const base = Math.min(canvas, FRAMED_DEFAULT_WIDTH);
  const title = options.title;
  if (typeof title !== 'string' || title === '') return { ...card, width: base };
  const font: FontSpec = { family: theme.type.family, ...theme.type.title };
  const lineWidth = Math.max(...title.split('\n').map((line) => measure(line.trim(), font).width));
  return { ...card, width: Math.max(base, Math.min(canvas, Math.ceil(lineWidth) + 2 * FRAMED_SIDE_MARGIN)) };
}

export function layoutSparkline(
  data: SparklineData,
  options: SparklineOptions = {},
): Geometry<SparklineMarks, SparklineDerived> {
  const warnings: LintWarning[] = [];
  const measure = options.measure ?? defaultMeasurer;
  // A card-class mark, like kpi: no width class over a 176 px box, or the
  // type scale would step down on every host that draws one.
  const theme = resolveSemanticPaletteTheme(resolveTheme(options.theme), options.palette, warnings);
  pushAll(warnings, ringToneRefusal(options));
  // A bare sparkline is a mark inside someone else's card and draws edge to
  // edge; one that carries a title is an exhibit and takes the canvas
  // margin. `canvas.margin` overrides either (the registry resolves it into
  // `options.margin` before layout sees it).
  const framed = (options.title !== undefined && options.title !== false)
    || options.subtitle !== undefined
    || options.source !== undefined
    || authoredNotes(options).length > 0;
  const size = framed ? framedCardSize(options, theme, measure) : resolveSize(cardSize(options, SPARKLINE_SIZE));
  const cells = (data.values ?? []).map((cell, index) => normalizeCell(cell, `values[${index}]`));
  if (cells.length === 0) throw new NormalizeError('empty-data', 'values', 'sparkline requires at least two values');
  if (cells.length < 2) {
    throw new NormalizeError('invalid-count', 'values', 'sparkline requires at least two values');
  }
  const values = cells.map((cell) => cellValue(cell));
  const labels = data.labels;
  if (labels !== undefined && labels.length !== cells.length) {
    warnings.push({
      code: 'sparkline-label-count',
      severity: 'warn',
      message: `labels has ${labels.length} entries for ${cells.length} values — the ends are labelled from the positions that exist`,
    });
  }

  // A framed sparkline is a narrow card: it keeps 28 px sides at every width,
  // where the canvas token gives 24 at 720 and 16 below 600 px.
  const token = canvasMargin(theme, size.width);
  const side = FRAMED_SIDE_MARGIN;
  const margin = {
    ...(framed
      ? { ...token, left: Math.max(token.left, side), right: Math.max(token.right, side) }
      : { top: 0, right: 0, bottom: 0, left: 0 }),
    ...options.margin,
  };
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame(
    { size, margin, cardGaps: true, ...frameTextOptions(options), subtitle: resolveSubtitle(options.subtitle), theme, measure },
    occupied,
  );
  const nodes: SceneNode[] = [...frame.nodes];
  const requests: LabelRequest[] = [];

  const endLabels = options.endLabels === 'ends' && labels !== undefined && labels.length > 0;
  // The end names are read, not glanced at: at least the reader floor of their axis role.
  const micro = microType(theme);
  const labelFont: FontSpec = { family: theme.type.family, ...micro, size: Math.max(micro.size, readerFloorPx(options.target ?? DEFAULT_TARGET, 'axis', textScaleOf(options))) };
  const endLabelAir = framed ? FRAMED_END_LABEL_AIR : 0;
  const labelBox = endLabels ? Math.ceil(labelFont.size * 1.3) + END_LABEL_GAP + endLabelAir : 0;
  // A framed exhibit that prints its last value also names its high point:
  // the line has no axis, and the high is the other number the climb is read by. It takes a label row above the line.
  const highRow = framed && options.valueLabel === 'last' ? Math.ceil(labelFont.size * 1.3) + 4 : 0;
  // Under the frame's plot minimum the line flattens to a hairline; the
  // frame then reports the height that fits, and the host grows or refuses.
  const room = frame.plot.h - labelBox;
  const ringPad = SPARKLINE_RING_RADIUS + strokeToken(theme, 'mark') / 2;
  // A framed line starts on the text edge: the ring sits at the end only, so
  // the first point needs no ring padding.
  const framedInset = framed ? ringPad : 0;
  const lineRoom = plotHeightAfter(frame, size.height, room);
  const high = highRow > 0 && lineRoom - highRow >= HIGH_POINT_MIN_BAND ? highRow : 0;
  const box: Rect = {
    x: frame.plot.x - framedInset,
    y: frame.plot.y + high,
    // The last value keeps its wider gap from the ring inside the box.
    w: frame.plot.w + framedInset - (framed && options.valueLabel === 'last' ? VALUE_LABEL_GAP - 4 : 0),
    h: lineRoom - high,
  };
  // target text must not press a framed line flat. It keeps the
  // 24 px a trend reads at, or the frame reports the height that holds it.
  // A bare sparkline with end labels keeps an 8 px trend on every target.
  // The plot floor (plotHeightAfter) still refuses a height that leaves the
  // line itself under its minimum.
  const bareEndLabelRoom = SPARK_BARE_END_LABEL_SPAN + 2 * ringPad;
  if (framed && room < SPARK_TREND_MIN) {
    frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, size.height + (frame.deficit ?? 0) + SPARK_TREND_MIN - room);
  }
  if (!framed && endLabels && room < bareEndLabelRoom) {
    frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, size.height + (frame.deficit ?? 0) + bareEndLabelRoom - room);
  }
  // the reference is part of the domain, so its line is always inside the box.
  const reference = options.reference;
  const domain = sparklineDomain(reference === undefined ? [values] : [values, [reference]], 'line');
  // The exhibit raster every other chart prints with: the example's style,
  // the plotted values' precision, grouped digits, so a computed value does not
  // print its whole float and 1.5e9 does not print as "1500000000".
  const formatValue = seriesRasterFormatter(options.format, reference === undefined ? values : [...values, reference], options.locale?.language, options.unit, options.target).fmt;
  // The last value beside the ring, for an exhibit that names no figure elsewhere.
  const lastIndex = lastObservedIndex(values);
  const valueFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const plotInput = {
    box,
    values,
    shape: 'line' as const,
    domain,
    // The mark owns its own padding: the ring must fit inside the box, and
    // nothing else claims room here.
    style: { padding: ringPad, strokeWidth: options.stroke ?? strokeToken(theme, 'data'), dotRadius: SPARKLINE_RING_RADIUS },
  };
  let plot = plotSparkline({
    ...plotInput,
    ...(options.valueLabel === 'last' && lastIndex !== undefined
      ? { lastText: formatValue(values[lastIndex]!), font: valueFont, measure } : {}),
  });
  // A number is never printed cut: "150000…" states no value. The label is
  // dropped, the line takes back the room the label had reserved, and the
  // warning names the fix (a magnitude format, or width).
  if (plot.label?.title !== undefined) {
    warnings.push({
      code: 'sparkline-value-label-cut',
      severity: 'warn',
      message: `the last value '${plot.label.title}' does not fit beside the line at ${size.width} px — the value label is dropped`,
      suggest: "author a format with a magnitude ('1.2M', '1.5bn') or widen the sparkline",
    });
    plot = plotSparkline(plotInput);
  }
  if (plot.label && plot.last && lastIndex !== undefined) {
    // Level with the ring, inside the box.
    const y = Math.min(Math.max(plot.last.y - plot.label.h / 2, box.y), box.y + box.h - plot.label.h);
    requests.push({
      id: 'spark:last',
      kind: 'point',
      pad: 0,
      typeRole: 'label',
      owner: { categoryId: sparklinePointId(lastIndex) },
      text: plot.label.text,
      lines: [plot.label.text],
      font: valueFont,
      priority: PRIORITY.endpoint,
      candidates: [{ slot: 'sparkLast', rect: { x: Math.min(plot.last.x + ringPad + (framed ? VALUE_LABEL_GAP : 4), frame.plot.x + frame.plot.w - plot.label.w), y, w: plot.label.w, h: plot.label.h }, penalty: 0 }],
    });
  }

  const owner = (index: number) => ({ categoryId: sparklinePointId(index) });
  if (reference !== undefined) {
    const y = plot.yAt(reference);
    nodes.push({
      t: 'line', id: 'spark:reference', x1: plot.plot.x, y1: y, x2: plot.plot.x + plot.plot.w, y2: y,
      stroke: { token: 'inkMuted' }, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference'), owner: {}, part: 'sparkReference',
    });
  }
  const d = plot.runs.filter((run) => run.length > 1).map((run) => linePath(run)).join('');
  if (d) {
    nodes.push({
      t: 'path',
      id: 'spark:line',
      d,
      // The mark ink, not the family's neutral: a theme whose neutral is the
      // table band (for example a sand over cream) would draw
      // the line in the band colour. The mark ink falls back to the ink.
      stroke: { token: 'markInk' },
      width: options.stroke ?? strokeToken(theme, 'data'),
      owner: {},
      part: 'spark',
    });
  }
  // A missing point is ringed on a dashed bridge, not left blank.
  pushAll(nodes, sparkGapNodes(theme, plot, { token: 'markInk' }, (suffix) => `spark:${suffix}`, owner, 'sparkGap'));
  // A value with a gap on both sides has no segment to draw; a dot shows it.
  for (const run of plot.runs) {
    if (run.length !== 1) continue;
    const [point] = run;
    if (plot.last && options.ring !== 'none' && point!.x === plot.last.x) continue;
    nodes.push({
      t: 'circle',
      id: `spark:dot:${Math.round(point!.x * 100) / 100}`,
      cx: point!.x,
      cy: point!.y,
      r: options.stroke ?? SPARKLINE_POINT_RADIUS,
      fill: { token: 'markInk' },
      owner: {},
      part: 'spark',
    });
  }
  if (plot.last && options.ring !== 'none') {
    nodes.push({
      t: 'circle',
      id: 'spark:ring',
      cx: plot.last.x,
      cy: plot.last.y,
      r: SPARKLINE_RING_RADIUS,
      fill: { token: 'background' },
      stroke: options.ringTone ? { token: options.ringTone } : semanticPalettePaint(theme, options.palette, 'highlight'),
      strokeWidth: strokeToken(theme, 'mark'),
      owner: owner(plot.last.index),
      part: 'sparkDot',
      display: { value: formatValue(plot.last.value) },
    });
  }
  // The high point: an ink dot and its value, muted, above it.
  const highIndex = high > 0 && plot.last ? values.reduce<number | undefined>((best, value, index) =>
    value !== null && (best === undefined || value > values[best]!) ? index : best, undefined) : undefined;
  if (highIndex !== undefined && plot.last && highIndex !== plot.last.index && values[highIndex]! > plot.last.value) {
    const x = plot.xAt(highIndex);
    const y = plot.yAt(values[highIndex]!);
    nodes.push({ t: 'circle', id: 'spark:high', cx: x, cy: y, r: 2.5, fill: { token: 'markInk' }, owner: owner(highIndex), part: 'sparkHigh' });
    const text = formatValue(values[highIndex]!);
    const m = measure(text, labelFont);
    const cap = measure.capHeight?.(labelFont) ?? labelFont.size * 0.72;
    const baseline = y - 10;
    requests.push({
      id: 'spark:high', kind: 'point', pad: 0, typeRole: 'label', owner: owner(highIndex), text, lines: [text], font: labelFont,
      priority: PRIORITY.endpoint - 1,
      candidates: [{ slot: 'above', rect: { x: Math.max(frame.plot.x, x - m.width / 2), y: baseline - m.height / 2 - cap / 2, w: m.width, h: m.height }, penalty: 0 }],
    });
  }
  if (endLabels) {
    const y = box.y + box.h + END_LABEL_GAP + endLabelAir;
    const ends: { id: string; index: number; align: 'start' | 'end' }[] = [
      { id: 'spark:label:first', index: 0, align: 'start' },
      { id: 'spark:label:last', index: cells.length - 1, align: 'end' },
    ];
    for (const end of ends) {
      const text = labels?.[end.index];
      if (text === undefined || text.length === 0) continue;
      const width = measure(text, labelFont).width;
      // The last name sits under the line's end, left of a value label's column.
      const x = end.align === 'start' ? box.x + ringPad : plot.plot.x + plot.plot.w;
      requests.push({
        id: end.id,
        kind: 'point',
        pad: 0,
        owner: owner(end.index),
        text,
        lines: [text],
        font: labelFont,
        role: 'category',
        typeRole: 'axis',
        priority: PRIORITY.endpoint + (end.align === 'end' ? 1 : 0),
        candidates: [{ slot: 'end', rect: { x: end.align === 'start' ? x : x - width, y, w: width, h: labelFont.size * 1.3 }, penalty: 0 }],
      });
    }
  }
  const solved = solveLabels(requests, occupied, labelCtx(theme, size, {}, {
    measure,
    plot: box,
    labelPad: 0,
  }));
  for (const label of solved.placed) if (label.id === 'spark:high') label.ink = { token: 'inkMuted' };
  pushAll(nodes, labelsToNodes(theme, solved.placed, (label) => requests.find((request) => request.id === label.id)!.font));

  const points = values.flatMap((value, index) => value === null
    ? []
    : [{
      id: sparklinePointId(index),
      index,
      x: plot.xAt(index),
      y: plot.yAt(value),
      ...(labels?.[index] ? { label: labels[index]! } : {}),
    }]);
  const marks: SparklineMarks = {
    plot: plot.plot,
    points,
    ...(lastIndex === undefined ? {} : { last: points[points.length - 1]! }),
  };
  const firstIndex = values.findIndex((value) => value !== null);
  const derived: SparklineDerived = {
    count: points.length,
    first: firstIndex === -1 ? null : values[firstIndex]!,
    last: lastIndex === undefined ? null : values[lastIndex]!,
    domain,
  };
  const constraints = (options as SparklineOptions & TargetSizeOptions)[TARGET_SIZE];
  const automaticHeight = constraints?.fixed.height === false
    || constraints === undefined && (options.size === undefined || typeof options.size === 'object' && options.size.height === undefined);
  // A framed exhibit scales the trend with its width: an authored width on any target but a dashboard tile,
  // and any framed card from 320 px, whose width was authored or not. A narrower tile keeps the short band.
  const authoredWidth = constraints?.fixed.width ?? options.size !== undefined;
  const naturalLineHeight = framed && automaticHeight
    && (authoredWidth && options.target !== 'dashboard' || size.width >= FRAMED_BAND_MIN_WIDTH)
    ? 2 * plotInput.style.padding + framedBand(size.width) + highRow
    : SPARKLINE_SIZE.height;
  return {
    type: 'sparkline',
    size,
    sizing: resolveSizing({ ...chartSizing('sparkline'), minWidth: 0 }, size, {
      // A framed sparkline takes the width it gets: at 176 px its title wraps one word a line, and a
      // content-fit container shrank a 520 px exhibit to that.
      naturalWidth: framed ? Math.max(SPARKLINE_SIZE.width, Math.ceil(size.width)) : SPARKLINE_SIZE.width,
      naturalHeight: naturalLineHeight + labelBox + (size.height - frame.plot.h),
    }),
    plot: box,
    scene: nodes,
    labels: solved.placed,
    axes: [],
    annotations: [],
    frame: frame.frame,
    marks,
    derived,
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'sparklineName')),
      counts: [structureCount('points', points.length, undefined, options)],
      desc: chartString(options, 'sparklineDesc', { v1: points.length, v2: derived.last === null ? '' : chartString(options, 'endingAt', { v1: formatValue(derived.last) }), v3: reference === undefined ? '' : chartString(options, 'referenceClause', { v1: formatValue(reference) }) }),
    },
    warnings: [...warnings, ...(frame.frame.warnings ?? []), ...solved.warnings],
    debug: { occupied: occupied.snapshot(), decisions: solved.decisions },
  };
}
