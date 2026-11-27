/** The standalone `sparkline` chart, drawn with the geometry in `layout.ts`. */
import { boldMeasurer, markBold } from '../../inlineBold';
import { SPARK_LABEL_SHARE } from './share';
import { chartString } from '../../strings/sparkline';
import { structureCount } from '../../structureCounts';
import { seriesRasterFormatter } from '../../formatSpec';
import { authoredNotes, frameTextOptions, plotHeightAfter, solveFrame } from '../../frame';
import type { Rect } from '../../geometry';
import { labelsToNodes } from '../../label/emit';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest } from '../../label/solver';
import { accessibleTitle, NormalizeError, resolveSize, resolveSubtitle } from '../../normalize/shared';
import { chartSizing, resolveSizing } from '../../sizing';
import { linePath } from '../../svgPath';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import {
  canvasMargin,
  emphasisWeight,
  microType,
  resolveSemanticPaletteTheme,
  resolveTheme,
  semanticPalettePaint,
  strokeToken,
  dashToken,
} from '../../theme';
import { readerFloorPx, textScaleOf } from '../../typeFloors';
import { cellMeta, cellValue, type Id } from '../../types/cell';
import type { SparklineData } from '../../types/data';
import type { SparklineOptions } from '../../types/options';
import { DEFAULT_TARGET, resolveTargetSize, TARGET_SIZE, type TargetSizeOptions } from '../../target';
import type { Geometry, LintWarning, SceneNode, ShownMark } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { normalizeCell } from '../../normalize/shared';
import { ringToneRefusal } from './refusals';
import { cardSize } from './card';
import { pushAll } from '../../arrays';
import { END_LABEL_GAP, SPARKLINE_RING_RADIUS, plotSparkline, sparkGapNodes, sparklineDomain, type SparklineDomain } from './layout';

/** The side margin of a framed sparkline on a render target (28 px at every width). */
const FRAMED_SIDE_MARGIN = 28;
/**
 * The width of a framed sparkline that authors none. At the 176 px of a bare tile its title, subtitle and source
 * wrap word by word, the line is a tenth of the canvas and the two end names touch.
 */
const FRAMED_DEFAULT_WIDTH = 320;
/** From this width a framed card draws the scaled line band on every target, the dashboard tile included. */
const FRAMED_BAND_MIN_WIDTH = 320;

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
/** Radius of an isolated point, independent of the line width. */
const SPARKLINE_POINT_RADIUS = 1.5;
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

/**
 * The points a framed line names besides its last: first observed, highest and
 * lowest (the first of a tie), and the row the line is read at. `last` is the last observed index.
 */
function pointRoles(values: readonly (number | null)[]): { first?: number; high?: number; low?: number; last?: number; next?: number } {
  const roles: { first?: number; high?: number; low?: number; last?: number; next?: number } = {};
  values.forEach((value, index) => {
    if (value === null) return;
    roles.first ??= index;
    if (roles.first !== index) roles.next ??= index;
    if (roles.high === undefined || value > values[roles.high]!) roles.high = index;
    if (roles.low === undefined || value < values[roles.low]!) roles.low = index;
    roles.last = index;
  });
  return roles;
}

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
  /** Under an authored format, the text each value's label would print (ShownMark): a point has no node of its own. */
  shown?: ShownMark[];
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
  if (typeof options.title !== 'string' || options.title === '') return { ...card, width: base };
  const title = markBold(options.title);
  if (title !== options.title) measure = boldMeasurer(measure, emphasisWeight(theme));
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
  if (cells.length === 0) throw new NormalizeError('empty-data', 'values', 'sparkline requires at least two values', undefined, undefined, ['data', 'values']);
  if (cells.length < 2) {
    throw new NormalizeError('invalid-count', 'values', 'sparkline requires at least two values', undefined, undefined, ['data', 'values']);
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
  // 'last-and-high' keeps those two numbers only. 'last' also names the low and the first value, and the
  // reference, so a line that dips below zero or starts far from its end states those numbers.
  const printsLast = options.valueLabel === 'last' || options.valueLabel === 'last-and-high';
  const namesMore = options.valueLabel === 'last';
  const highRow = framed && printsLast ? Math.ceil(labelFont.size * 1.3) + 4 : 0;
  // Under the frame's plot minimum the line flattens to a hairline; the
  // frame then reports the height that fits, and the host grows or refuses.
  const room = frame.plot.h - labelBox;
  const ringPad = SPARKLINE_RING_RADIUS + strokeToken(theme, 'mark') / 2;
  // A framed line starts on the text edge: the ring sits at the end only, so
  // the first point needs no ring padding.
  const framedInset = framed ? ringPad : 0;
  const lineRoom = plotHeightAfter(frame, size.height, room);
  const high = highRow > 0 && lineRoom - highRow >= HIGH_POINT_MIN_BAND ? highRow : 0;
  // the reference is part of the domain, so its line is always inside the box.
  const reference = options.reference;
  const domain = sparklineDomain(reference === undefined ? [values] : [values, [reference]], 'line');
  // The exhibit raster every other chart prints with: the example's style,
  // the plotted values' precision, grouped digits, so a computed value does not
  // print its whole float and 1.5e9 does not print as "1500000000".
  const formatValue = seriesRasterFormatter(options.format, reference === undefined ? values : [...values, reference], options.locale?.language, options.unit).fmt;
  // The last value beside the ring, for an exhibit that names no figure elsewhere.
  const roles = pointRoles(values);
  const lastIndex = roles.last;
  const valueFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  // The low and the first value come with the high label: a high that is the last point names nothing else.
  const namesHigh = roles.high !== undefined && lastIndex !== undefined && roles.high !== lastIndex && values[roles.high]! > values[lastIndex]!;
  const firstShown = namesMore && namesHigh && roles.first !== roles.high && roles.first !== roles.low;
  const lowShown = namesMore && namesHigh && roles.low !== lastIndex && roles.low !== roles.high;
  // A first value on a rising line sits under its point, away from the line, in the row the low takes.
  const firstBelow = firstShown && roles.next !== undefined && values[roles.next]! > values[roles.first!]!;
  const bottomWanted = highRow > 0 && (lowShown || firstBelow) ? highRow : 0;
  const bottom = bottomWanted > 0 && high > 0 && lineRoom - high - bottomWanted >= HIGH_POINT_MIN_BAND ? bottomWanted : 0;
  const drawLow = lowShown && bottom > 0;
  const drawFirst = firstShown && (!firstBelow || bottom > 0) && high > 0;
  // The reference prints its value in the last value's column, so the column takes the wider of the two.
  // A number is never printed cut, so a reference wider than the share a value may take prints nothing.
  const referenceWidth = framed && namesMore && reference !== undefined ? measure(formatValue(reference), valueFont).width : 0;
  const referenceText = referenceWidth > 0 && referenceWidth <= Math.max(12, frame.plot.w * SPARK_LABEL_SHARE) && lastIndex !== undefined
    ? formatValue(reference!) : undefined;
  const referenceExtra = referenceText !== undefined
    ? Math.max(0, referenceWidth - measure(formatValue(values[lastIndex!]!), valueFont).width) : 0;
  const box: Rect = {
    x: frame.plot.x - framedInset,
    y: frame.plot.y + high,
    // The last value keeps its wider gap from the ring inside the box.
    w: frame.plot.w + framedInset - (framed && printsLast ? VALUE_LABEL_GAP - 4 : 0) - referenceExtra,
    h: lineRoom - high - bottom,
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
    ...(printsLast && lastIndex !== undefined
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
      // A label that would be cut is dropped above, so this one prints the whole value.
      shows: { value: formatValue(values[lastIndex]!) },
      lines: [plot.label.text],
      font: valueFont,
      priority: PRIORITY.endpoint,
      candidates: [{ slot: 'sparkLast', rect: { x: Math.min(plot.last.x + ringPad + (framed ? VALUE_LABEL_GAP : 4), frame.plot.x + frame.plot.w - plot.label.w), y, w: plot.label.w, h: plot.label.h }, penalty: 0 }],
    });
    if (referenceText !== undefined) {
      // The reference's value in the last value's column, level with the dashed line. Where it meets
      // the last value it steps away from it: down when the line is below the last point, else up.
      const x = Math.min(plot.last.x + ringPad + (framed ? VALUE_LABEL_GAP : 4), frame.plot.x + frame.plot.w - referenceWidth);
      const refY = plot.yAt(reference!);
      const h = plot.label.h;
      const level = Math.min(Math.max(refY - h / 2, box.y), box.y + box.h - h);
      const stepped = refY >= plot.last.y ? y + h : y - h;
      requests.push({
        id: 'spark:referenceValue', kind: 'point', pad: 0, typeRole: 'label', owner: {}, text: referenceText, lines: [referenceText], font: valueFont,
        priority: PRIORITY.endpoint - 2,
        candidates: [
          { slot: 'sparkReference', rect: { x, y: level, w: referenceWidth, h }, penalty: 0 },
          { slot: 'sparkReferenceStep', rect: { x, y: stepped, w: referenceWidth, h }, penalty: 1 },
        ],
      });
    }
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
  pushAll(nodes, sparkGapNodes(theme, plot, { token: 'markInk' }, (suffix) => `spark:${suffix}`, owner, 'sparkGap', options.locale?.language));
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
  // The high, low and first points: an ink dot and its value, muted, above the high and the first on a falling line,
  // under the low and the first on a rising one, away from the line.
  const pointLabel = (id: string, index: number, below: boolean) => {
    const x = plot.xAt(index);
    const y = plot.yAt(values[index]!);
    nodes.push({ t: 'circle', id: `spark:${id}`, cx: x, cy: y, r: 2.5, fill: { token: 'markInk' }, owner: owner(index), part: `spark${id[0]!.toUpperCase()}${id.slice(1)}` });
    const text = formatValue(values[index]!);
    const m = measure(text, labelFont);
    const cap = measure.capHeight?.(labelFont) ?? labelFont.size * 0.72;
    const baseline = below ? y + 10 + cap : y - 10;
    const left = id === 'low' ? Math.min(Math.max(frame.plot.x, x - m.width / 2), frame.plot.x + frame.plot.w - m.width) : Math.max(frame.plot.x, x - m.width / 2);
    requests.push({
      id: `spark:${id}`, kind: 'point', pad: 0, typeRole: 'label', owner: owner(index), text, shows: { value: text }, lines: [text], font: labelFont,
      priority: PRIORITY.endpoint - 1,
      candidates: [{ slot: below ? 'below' : 'above', rect: { x: left, y: baseline - m.height / 2 - cap / 2, w: m.width, h: m.height }, penalty: 0 }],
    });
  };
  if (high > 0 && namesHigh) pointLabel('high', roles.high!, false);
  if (drawLow) pointLabel('low', roles.low!, true);
  if (drawFirst) pointLabel('first', roles.first!, firstBelow);
  if (endLabels) {
    const y = box.y + box.h + bottom + END_LABEL_GAP + endLabelAir;
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
  const solved = solveLabels(requests, occupied, labelCtx(theme, size, options, {
    measure,
    plot: box,
    labelPad: 0,
  }));
  for (const label of solved.placed) if (['spark:high', 'spark:low', 'spark:first', 'spark:referenceValue'].includes(label.id)) label.ink = { token: 'inkMuted' };
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
  // Under an authored format a value with no label takes the text its label would print.
  const authored = options.format !== undefined || cells.some((cell) => cellMeta(cell)?.format !== undefined);
  const marks: SparklineMarks = {
    plot: plot.plot,
    points,
    ...(lastIndex === undefined ? {} : { last: points[points.length - 1]! }),
    ...(authored ? { shown: points.map((point) => ({ owner: owner(point.index), shows: { value: formatValue(values[point.index]!) } })) } : {}),
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
    ? 2 * plotInput.style.padding + framedBand(size.width) + highRow + (framed && highRow > 0 && namesHigh && (lowShown || firstBelow) ? highRow : 0)
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
