import { SPARK_LABEL_SHARE } from './share';
import { chartString } from '../../strings/sparkline';
/**
 * Sparkline geometry, shared by the KPI card, the table encoding cell and
 * the standalone `sparkline` chart in `chart.ts`. Shape-only:
 * no axes, grid, or invented markers. Layout owns positions; renderers paint
 * the returned nodes.
 */

import { cutWithTitle } from '../../label/fitText';
import { formatterFromExample } from '../../formatSpec';
import type { Rect } from '../../geometry';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import { bandScale, linearScale } from '../../scale';
import { linePath } from '../../svgPath';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  semanticPalettePaint,
  strokeToken,
  dashToken,
} from '../../theme';
import { cellMeta, cellValue, type Cell, type Id, type OwnerRef } from '../../types/cell';
import type { Paint, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { normalizeCell } from '../../normalize/shared';
import { pushAll } from '../../arrays';

/** Radius and stroke of the endpoint ring, the table hover card's own pair. */
export const SPARKLINE_RING_RADIUS = 3.2;
/** Air between the line and the end labels under it. */
export const END_LABEL_GAP = 2;

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
export function sparkGapNodes(theme: Theme, plot: SparklinePlot, paint: Paint, nodeId: (suffix: string) => Id, owner: (index: number) => OwnerRef, part: string, language: string | undefined): SceneNode[] {
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
      display: { value: chartString({ locale: { language } }, 'noValue'), state: 'missing' },
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
  /** The chart language, for the words of a missing point. */
  language?: string;
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
    partPrefix === 'kpi' ? 'sparkGap' : 'tableSparkGap', input.language));

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
  const endNumber = lastIndex === undefined || theme.marks?.sparkEndLabel === false ? undefined : lastFormat(values[lastIndex]!);
  const endText = endNumber === undefined ? undefined : cellLabelText(endpointLabel, endNumber);
  // The number the end label prints, unless an authored text replaces it.
  const endShows = endNumber !== undefined && (typeof endpointLabel !== 'string' || endpointLabel.includes('${value}')) ? { value: endNumber } : undefined;
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
    language: card.locale,
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
      // A label cut short prints no whole number.
      ...(endShows && plot.label.title === undefined ? { shows: endShows } : {}),
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
