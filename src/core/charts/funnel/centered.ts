import { chartString } from '../../strings/funnel';
import { chartPalette, chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import type { AdjacentSeriesPaintSample, PaintWarningRule } from '../../types/scene';
/**
 * Classic centered funnel. Stage values own the widths at horizontal
 * boundaries; equal-height trapezoids only connect those measured widths.
 */

import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { adjacentSeriesWarnings, retainAdjacentWarningRule, type AdjacentWarningCapture, type SeriesColorSample } from '../../adjacentSeries';
import { formatAutomaticNumber, formatAutomaticPercent, notApplicableGlyph, smallRateDecimals } from '../../format';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { cellMeta } from '../../types/cell';
import type { Rect } from '../../geometry';
import { clamp, rectContains } from '../../geometry';
import { authoredNotes, frameTextOptions, normalizeLegendOption, solveFrame, type LegendItemInput } from '../../frame';
import { labelsToNodes } from '../../label/emit';
import { isOthersFill, othersSeparation } from '../../markVisibility';
import { createOccupiedIndex } from '../../label/occupied';
import { labelCtx, PRIORITY, solveLabels, type LabelRequest, type SolveCtx } from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeSeriesValues,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { defaultMeasurer, type FontSpec, type TextMeasurer } from '../../text';
import { rowSizing } from '../../sizing';
import {
  effectiveFill,
  markRolePaint,
  mixedPaint,
  paintColor,
  PLAN_MUTED_PAINT,
  seriesPaint as themeSeriesPaint,
  solidMutedPlan,
  STAGE_SHADE_MAX,
  emphasisWeight,
  strokeToken,
  canvasMargin,
} from '../../theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { ChartData, Series } from '../../types/data';
import type { FunnelOptions, LabelKind } from '../../types/options';
import type { Theme } from '../../types/theme';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import type { FunnelDerived, FunnelMarks } from './layout';
import { clampedNote, deriveFunnel, funnelValueFormats, missingGlyph } from './derive';
import { composedTextRole } from '../../textRole';
import { disclosureNote } from '../../notes';
import { maxOf, pushAll } from '../../arrays';
import { emptyIdRecord } from '../../idRecords';

const CVR_SPAN_HEADER = 'cvr:span-header';

interface StageLabelInfo {
  text: string;
  lines: string[];
  w: number;
  h: number;
}

function stageLabelInfo(name: string, value: string, font: FontSpec, measure: TextMeasurer): StageLabelInfo {
  const lines = value ? [name, value] : [name];
  return { text: lines.join(' · '), lines,
    w: Math.max(...lines.map((line) => measure(line, font).width)),
    h: font.size * (font.lineHeight ?? 1.2) * lines.length };
}

function centeredLabelNodes(theme: Theme, labels: PlacedLabel[], strong: FontSpec, header: FontSpec, labelFont: FontSpec, marks: SceneNode[]): SceneNode[] {
  const emitted = labelsToNodes(theme, labels, (label) =>
    label.id.startsWith('stage:') ? strong : label.id === 'total-cvr:header' || label.id === 'step-cvr:header' || label.id === CVR_SPAN_HEADER ? header : labelFont, marks);
  // a stage label prints its name bold over its value in
  // the regular face (headLines), and the value line follows the name's
  // alignment: centred inside the band, flush right in the outside column.
  const byNode = new Map(labels.map((label) => [label.nodeId, label]));
  for (const node of emitted) {
    if (node.t !== 'text' || !node.id.endsWith(':body')) continue;
    const label = byNode.get(node.id.slice(0, -':body'.length));
    if (!label?.align) continue;
    node.x = label.align === 'middle' ? label.rect.x + label.rect.w / 2 : label.rect.x + label.rect.w;
    node.align = label.align;
    // The value line under the name reads as a value.
    node.role = composedTextRole(node.lines.join(' '));
    // Both lines sit on the 0.01 px raster the SVG prints, one line apart, so
    // rounding never lets the two line boxes overlap.
    const head = emitted.find((item) => item.id === label.nodeId);
    if (head?.t === 'text') {
      const round = (v: number): number => Math.round(v * 100) / 100;
      head.y = round(head.y);
      node.y = round(head.y + node.font.size * (node.font.lineHeight ?? 1.2));
    }
  }
  return emitted;
}

/** Space between the outside stage-name column and the funnel's widest edge. */
const LABEL_COLUMN_GAP = 8;


/**
 * A funnel fill under `marks.funnelFill: 'ramp'`, both layouts:
 * a single series takes the series ramp by stage, an outcome split takes it
 * by series, and the lost share (colorRole 'status-lost' or 'bad') is the
 * bad fill at 45 %. The status colours never reach the bars, so a theme
 * whose status map borrows a text colour cannot fill a stage with it.
 * Undefined keeps the layout's own paint: the theme keeps 'status', or the
 * series authors a fill.
 */
export function rampFunnelPaint(
  theme: Theme, plotted: readonly Series[], series: Series, stageIndex: number, palette: string | undefined, stageCount: number,
): Paint | undefined {
  if (theme.marks?.funnelFill !== 'ramp' || series.fill) return undefined;
  // A single series takes the ramp by stage only while every stage has a step
  // of its own: past the ramp's end the last two stages would share a fill,
  // so the layout's own paint takes over.
  const ramp = theme.color.palettes?.[palette ?? ''] ?? theme.color.series;
  if (plotted.length === 1 && stageCount > ramp.length) return undefined;
  const lost = (candidate: Series) => candidate.colorRole === 'status-lost' || candidate.colorRole === 'bad';
  if (lost(series)) return { token: 'badFill', tint: 0.55 };
  const rank = plotted.length === 1 ? stageIndex : plotted.filter((candidate) => !lost(candidate)).indexOf(series);
  return themeSeriesPaint(Math.max(0, rank), palette);
}

export function shadeStage(paint: Paint, index: number, count: number, direction: FunnelOptions['stageShade']): Paint {
  const progress = index / (count - 1);
  return shadeBy(paint, STAGE_SHADE_MAX * (direction === 'lighten' ? progress : 1 - progress));
}

function shadeBy(paint: Paint, amount: number): Paint {
  if (amount <= 0) return paint;
  return mixedPaint(paint, { token: 'background', theme: { kind: 'brighter-pole' } }, 1 - amount, 'token' in paint ? paint.token : 'series-1');
}

function insideStagePaint(paint: Paint, pattern: 'outline' | undefined, theme: Theme) {
  return {
    insidePaint: paint,
    insidePattern: pattern,
    insideFill: effectiveFill(paintColor(theme, paint), pattern, theme),
  };
}

/** The widest boundary of a centred funnel is never narrower than this; the compact form takes 64. */
const MIN_FUNNEL_W = 96;
const MIN_FUNNEL_W_COMPACT = 64;

export function layoutCenteredFunnel(
  data: ChartData,
  options: FunnelOptions,
): Geometry<FunnelMarks, FunnelDerived> {
  const warnings: LintWarning[] = [];
  if (options.bandFraction !== undefined) {
    warnings.push({
      code: 'funnel-centered-band-fraction-ignored',
      severity: 'info',
      message: "variant:'centered' uses equal, contiguous stage heights — bandFraction is ignored",
    });
  }
  if (options.worstDropCallout) {
    warnings.push({ code: 'funnel-worst-drop-callout-rows-only', severity: 'warn', message: "funnel worstDropCallout requires variant:'rows' — ignored" });
  }

  const theme = chartTheme(options);
  const na = notApplicableGlyph(options.strings);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  const autoDecimals = (value: number) =>
    Number.isInteger(value) || Math.abs(value) >= 100 ? 0 : 1;
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (value: number) => formatAutomaticNumber(value, { locale: options.locale?.language, ...{ decimals: autoDecimals(value) } });
  const fmtPct = (rate: number) => {
    const pct = rate * 100;
    return formatAutomaticPercent(pct, smallRateDecimals(pct), false, options.locale?.language);
  };
  const highlights = new Set(resolveHighlight(options.highlight));
  const labelsOpt = options.labels;
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind);

  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'funnel requires at least one stage');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'funnel requires at least one series');
  }
  const stages = data.categories.map((category, index) =>
    normalizeCategory(category as never, index),
  );
  const plotted = data.series.filter((series) => series.role !== 'reference');
  if (plotted.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'funnel requires at least one data-role series');
  }
  const numbers = deriveFunnel(plotted, stages, fmt, warnings);
  const { stageTotals, conversions, worstDrop } = numbers;
  // Geometry draws a missing value as nothing (0 wide); its text and every
  // derived rate read the nullable numbers.
  const values = numbers.values.map((row) => row.map((value) => value ?? 0));
  const glyph = missingGlyph(theme);
  const cells = plotted.map((series, si) => normalizeSeriesValues(series, stages, si));
  if (plotted.length > 1 && cells.some(row => row.some(cell => cellMeta(cell)?.label !== undefined))) {
    warnings.push({
      code: 'funnel-cell-label-ignored', severity: 'warn',
      message: 'values[].label has no effect on a centered funnel with several series because each stage prints its total, not segment values.',
      suggest: "Set variant: 'rows' to show the cell labels, or remove values[].label.",
    });
  }
  // One raster per stage: the values of one stage share one decimal count, and a stage of whole counts prints none.
  // A single series is one raster down its stages (one decimal count within a series).
  const formats = stages.map((_, ci) => seriesRasterFormatter(options.format, plotted.length === 1 ? numbers.values[0]! : plotted.map((_, si) => numbers.values[si]![ci]), options.locale?.language, options.unit, options.target, undefined, true));
  // Totals and series without format metadata print through the shared raster (one decimal count, engine scale).
  const totalRaster = seriesRasterFormatter(options.format, Object.values(stageTotals), options.locale?.language, options.unit, options.target);
  // A whole count prints whole beside fractional values of its stage ("140", "1" beside "0.6"); an amount like 100.4 keeps its decimals.
  if (!options.format) for (const format of [...formats, totalRaster]) format.spec.wholeCounts = true;
  const { valueText, totalFmt } = funnelValueFormats(plotted, cells, formats, totalRaster);


  const firstTotal = stageTotals[stages[0]!.id] ?? null;
  const cumulativeCvrs = stages.map((stage, ci) => {
    const total = stageTotals[stage.id] ?? null;
    // A stage drawn at zero for a negative value has no rate, and none is measured from it.
    const measurable = !numbers.clampedStages[0] && !numbers.clampedStages[ci];
    return { stageId: stage.id, rate: measurable && firstTotal !== null && firstTotal > 0 && total !== null ? total / firstTotal : null };
  });
  const totalText = (stage: { id: Id }): string => {
    const total = numbers.shownTotals[stage.id] ?? null;
    if (total === null) return glyph;
    if (plotted.length !== 1) return totalFmt(total);
    const ci = stages.findIndex(item => item.id === stage.id);
    const label = cellMeta(cells[0]![ci]!)?.label;
    const text = valueText(0, ci, total);
    return label === false ? '' : typeof label === 'string' ? label.replace(/\$\{value\}/g, text) : text;
  };
  const stageCvrText = (categoryIndex: number): string => {
    // The first stage has no previous one to convert from.
    if (categoryIndex === 0) return '–';
    const previous = stages[categoryIndex - 1]!;
    const stage = stages[categoryIndex]!;
    const conversion = conversions.find(
      (candidate) => candidate.fromId === previous.id && candidate.toId === stage.id,
    );
    if (!conversion) return na;
    return conversion.rate > 1 ? 'increased' : fmtPct(conversion.rate);
  };
  const cumulativeCvrText = (rate: number | null): string => {
    if (rate === null) return na;
    return rate > 1 ? 'increased' : fmtPct(rate);
  };

  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // The sides follow the shared margin by width (16/24/28), not a literal 28.
  const sides = canvasMargin(theme, size.width);
  const margin = { top: 20, right: sides.right, bottom: 16, left: sides.left, ...options.margin };
  // A stage split into several series names them in a key above the
  // plot unless the author turned the key off.
  const legendOpts = normalizeLegendOption(options.legend, plotted.length > 1 ? { position: 'top' } : undefined);
  const legendItems: LegendItemInput[] = plotted.map((series, seriesIndex) => ({
    id: series.id,
    label: series.label ?? series.id,
    paint: seriesPaint(series, seriesIndex),
    pattern: centeredPattern(series),
  }));
  if (legendOpts?.order) {
    const rank = new Map(legendOpts.order.map((id, index) => [id, index]));
    legendItems.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [
        ...authoredNotes(options),
        ...clampedNote(numbers.clamped, options),
        ...(numbers.undefinedSteps.length ? [disclosureNote(chartString(options, 'funnelUndefined', { v1: na }))] : []),
      ],
      legend: legendOpts ? { options: legendOpts, items: legendItems } : undefined,
      theme,
      measure,
    },
    occupied,
  );
  const inner = frameResult.plot;
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const headerFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const stageLabelInfos = stages.map((stage) => stageLabelInfo(
    stage.label ?? stage.id, totalText(stage), strongFont, measure,
  ));
  const showTotalCvr = options.totalCvr === 'column' && labelsOpt !== false;
  // the cumulative rate is the column's message and prints bold.
  const cvrFont = strongFont;
  // Compact form: the column heads wrap to one word per line and the
  // columns keep 10 px instead of 16, the funnel narrows to 64 px.
  const compactForm = options.mode === 'compact';
  const colPad = compactForm ? 10 : 16;
  // the heads also take one word per line when the stage
  // labels do not all fit inside their bands with one-line heads (see allInside).
  let splitHeads = compactForm;
  const headLines = (text: string) => splitHeads ? text.split(' ') : [text];
  const headSize = (text: string) => {
    const lines = headLines(text);
    return { width: Math.max(...lines.map((line) => measure(line, headerFont).width)), height: lines.length * measure(lines[0]!, headerFont).height };
  };
  // With both rate columns, one spanning
  // head "Conversion rate" stands over the short heads "Step" and "Total".
  const spanForm = showTotalCvr && labelOn('annotation') && labelOn('point') && stages.length > 1;
  const spanText = chartString(options, 'cvrSpanHeader');
  const spanSize = measure(spanText, headerFont);
  const cvrHeaderText = chartString(options, spanForm ? 'totalCvrShort' : 'totalCvr');
  let cvrHeaderSize = headSize(cvrHeaderText);
  const cvrTexts = cumulativeCvrs.map((item) => cumulativeCvrText(item.rate));
  const cvrSizes = cvrTexts.map((text) => measure(text, cvrFont));
  let cvrBlockWidth = showTotalCvr
    ? Math.max(cvrHeaderSize.width, maxOf(cvrSizes.map((item) => item.width))) + colPad
    : 0;
  // The conversion from the previous stage is a named column, "Step CVR",
  // in the style of "Total CVR", not an unnamed third line in each stage.
  const showStepCvr = labelsOpt !== false && labelOn('point') && stages.length > 1;
  const stepHeaderText = chartString(options, spanForm ? 'stepCvrShort' : 'stepCvr');
  let stepHeaderSize = headSize(stepHeaderText);
  const stepTexts = stages.map((_, index) => stageCvrText(index));
  const stepSizes = stepTexts.map((text) => measure(text, labelFont));
  let stepBlockWidth = showStepCvr
    ? Math.max(stepHeaderSize.width, maxOf(stepSizes.map((item) => item.width))) + colPad
    : 0;
  // the table head keeps the height of its two-line form
  // whichever form prints, so the head form never changes the rows' height
  // and the natural height of the chart stays one number.
  const headBlockH = (): number => 2 * measure(stepHeaderText.split(' ')[0] ?? '', headerFont).height;
  let headerReserve = showTotalCvr || showStepCvr ? headBlockH() + 8 : 0;
  let rowsTop = inner.y + headerReserve;
  const rowsBottom = inner.y + inner.h;
  let rowsHeight = Math.max(stages.length, rowsBottom - rowsTop);
  let bandHeight = rowsHeight / stages.length;
  const setTableForm = (split: boolean): void => {
    splitHeads = split;
    cvrHeaderSize = headSize(cvrHeaderText);
    cvrBlockWidth = showTotalCvr ? Math.max(cvrHeaderSize.width, maxOf(cvrSizes.map((item) => item.width))) + colPad : 0;
    stepHeaderSize = headSize(stepHeaderText);
    stepBlockWidth = showStepCvr ? Math.max(stepHeaderSize.width, maxOf(stepSizes.map((item) => item.width))) + colPad : 0;
    headerReserve = showTotalCvr || showStepCvr ? headBlockH() + 8 : 0;
    rowsTop = inner.y + headerReserve;
    rowsHeight = Math.max(stages.length, rowsBottom - rowsTop);
    bandHeight = rowsHeight / stages.length;
  };
  const maxTotal = Math.max(0, maxOf(numbers.known));
  const boundaryWidthFor = (categoryIndex: number, funnelWidth: number): number =>
    maxTotal > 0 ? (numbers.known[categoryIndex]! / maxTotal) * funnelWidth : 0;

  const fitsInside = (
    categoryIndex: number,
    funnelWidth: number,
    label: StageLabelInfo,
  ): boolean => {
    if (label.h + 6 > bandHeight) return false;
    const topWidth = boundaryWidthFor(categoryIndex, funnelWidth);
    const bottomWidth = boundaryWidthFor(
      Math.min(categoryIndex + 1, stages.length - 1),
      funnelWidth,
    );
    const topT = clamp((bandHeight - label.h) / 2 / bandHeight, 0, 1);
    const bottomT = clamp((bandHeight + label.h) / 2 / bandHeight, 0, 1);
    const widthAt = (t: number) => topWidth + (bottomWidth - topWidth) * t;
    return Math.min(widthAt(topT), widthAt(bottomT)) >= label.w + 12;
  };

  const minFunnelW = compactForm ? MIN_FUNNEL_W_COMPACT : MIN_FUNNEL_W;
  const cagrReserve = (options.annotations ?? []).some(ann => ann.kind === 'cagr')
    ? measure('−100.0% p.a.', strongFont).width + (compactForm ? 24 : 48) : 0;
  // One placement for every stage label.
  // All inside when every label fits its band; otherwise all in one column
  // left of the funnel, flush right towards it, without leaders, so the
  // funnel keeps the rest of the width.
  const fitAllInside = (): boolean => stageLabelInfos.every((label, categoryIndex) =>
    fitsInside(categoryIndex, Math.max(10, inner.w - stepBlockWidth - cvrBlockWidth - cagrReserve), label));
  let allInside = fitAllInside();
  // The narrower table also widens a funnel whose labels stand outside.
  if (!allInside && !splitHeads && labelOn('total')) {
    setTableForm(true);
    allInside = fitAllInside();
  }
  const labelColumnW = labelOn('total') && !allInside
    ? maxOf(stageLabelInfos.map((label) => label.w)) + LABEL_COLUMN_GAP : 0;
  const funnelWidth = Math.max(10, inner.w - stepBlockWidth - cvrBlockWidth - cagrReserve - labelColumnW);
  const funnelLeft = inner.x + labelColumnW;
  // A wider funnel can take its labels inside, so the measured floor is
  // the narrowest funnel-plus-outside-labels from the minimum funnel up.
  // shortcut: 4 px scan up to 640 px; a closed form when stage counts grow.
  let narrowestFunnel = Infinity;
  // The new placement: the narrowest funnel that holds every label inside, or
  // the minimum funnel with the label column beside it.
  const columnW = labelOn('total') ? maxOf(stageLabelInfos.map((label) => label.w)) + LABEL_COLUMN_GAP : 0;
  for (let w = minFunnelW; w <= Math.max(minFunnelW, 640); w += 4) {
    const outside = stageLabelInfos.every((label, ci) => fitsInside(ci, w, label)) ? 0 : columnW;
    narrowestFunnel = Math.min(narrowestFunnel, w + outside);
    if (outside === 0) break;
  }
  narrowestFunnel = Math.min(narrowestFunnel, minFunnelW + columnW);
  const axisX = funnelLeft + funnelWidth / 2;
  // A CAGR bracket stands between the funnel and the conversion columns, so
  // its arrow ends beside its stage and not beside a column's figure.
  const stepX = funnelLeft + funnelWidth + cagrReserve + 8;
  const cvrX = stepX + stepBlockWidth;
  // figures and heads stand flush right in their columns.
  /** A head stands on the bottom of the head block. */
  const headY = (h: number): number => inner.y + Math.max(0, headerReserve - 8 - h);
  const flushRight = (x: number, block: number, w: number): number => x + Math.max(0, block - colPad) - w;
  const boundaryWidths: Record<Id, number> = emptyIdRecord();
  stages.forEach((stage, categoryIndex) => {
    boundaryWidths[stage.id] = boundaryWidthFor(categoryIndex, funnelWidth);
  });
  const plot: Rect = { x: funnelLeft, y: rowsTop, w: funnelWidth, h: rowsHeight };

  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: FunnelMarks = { rows: [] };
  const labelRequests: LabelRequest[] = [];
  const rowLanes: Rect[] = [];

  stages.forEach((stage, categoryIndex) => {
    const yTop = rowsTop + categoryIndex * bandHeight;
    const yBottom = yTop + bandHeight;
    const nextIndex = Math.min(categoryIndex + 1, stages.length - 1);
    const topWidth = boundaryWidths[stage.id]!;
    const bottomWidth = boundaryWidths[stages[nextIndex]!.id]!;
    const fullRect: Rect = {
      x: axisX - Math.max(topWidth, bottomWidth) / 2,
      y: yTop,
      w: Math.max(topWidth, bottomWidth),
      h: bandHeight,
    };
    const lane: Rect = { x: inner.x, y: yTop, w: inner.w, h: bandHeight };
    rowLanes.push(lane);
    const segmentRecords: FunnelMarks['rows'][number]['segments'] = [];
    let topCumulative = 0;
    let bottomCumulative = 0;

    plotted.forEach((series, seriesIndex) => {
      const topValue = values[seriesIndex]![categoryIndex]!;
      const bottomValue = values[seriesIndex]![nextIndex]!;
      const topLeft = axisX - topWidth / 2 + scaleValue(topCumulative);
      const topRight = topLeft + scaleValue(topValue);
      const bottomLeft = axisX - bottomWidth / 2 + scaleValue(bottomCumulative);
      const bottomRight = bottomLeft + scaleValue(bottomValue);
      topCumulative += topValue;
      bottomCumulative += bottomValue;
      if ((topValue <= 0 && bottomValue <= 0) || numbers.values[seriesIndex]![categoryIndex] === null) return;

      const rect: Rect = {
        x: Math.min(topLeft, bottomLeft),
        y: yTop,
        w: Math.max(topRight, bottomRight) - Math.min(topLeft, bottomLeft),
        h: bandHeight,
      };
      const nodeId = `mark:${stage.id}:${series.id}`;
      const pattern = centeredPattern(series);
      const paint = stagePaint(series, seriesIndex, categoryIndex);
      // A theme's solid, muted plan look draws the stage without its outline.
      const outlined = pattern === 'outline' && !solidMutedPlan(theme);
      // The Others family rule: a pale Rest stage takes the separation outline in place of the page-colour edge.
      const sep = pattern === undefined ? othersSeparation(paint, theme) : undefined;
      const pathNode: Extract<SceneNode, { t: 'path' }> = {
        t: 'path',
        id: nodeId,
        d: quadrilateralPath(topLeft, topRight, bottomRight, bottomLeft, yTop, yBottom),
        fill: outlined ? { token: 'background' } : pattern === 'outline' ? PLAN_MUTED_PAINT : paint,
        stroke: outlined ? paint : sep?.stroke ?? { token: 'background' },
        width: outlined ? theme.pattern.outlineStrokeWidth : sep?.strokeWidth ?? strokeToken(theme, 'hair'),
        ...(pattern === undefined && isOthersFill(paint) ? { separation: { fill: paint, backing: { token: 'background' } as const, fallback: { stroke: { token: 'background' } as const, strokeWidth: strokeToken(theme, 'hair') } } } : {}),
        owner: { categoryId: stage.id, seriesId: series.id },
        part: 'segment',
      };
      nodes.push(pathNode);
      occupied.claim(rect, 'mark', pathNode.owner, pathNode.part);
      segmentRecords.push({ id: series.id, rect, nodeId });
    });

    marks.rows.push({
      categoryId: stage.id,
      rect: fullRect,
      lane,
      segments: segmentRecords,
    });

    if (labelOn('total')) {
      const info = stageLabelInfos[categoryIndex]!;
      const rowCenterY = yTop + bandHeight / 2;
      const inside = allInside;
      const candidates = inside
        ? [{
            slot: 'insideCenter',
            rect: {
              x: axisX - info.w / 2,
              y: rowCenterY - info.h / 2,
              w: info.w,
              h: info.h,
            },
            penalty: 0,
            ...(plotted.length === 1
              ? insideStagePaint(stagePaint(plotted[0]!, 0, categoryIndex), centeredPattern(plotted[0]!), theme)
              : { needsBacking: true }),
          }]
        : [{
            slot: 'outsideLeft',
            rect: { x: funnelLeft - LABEL_COLUMN_GAP - info.w, y: rowCenterY - info.h / 2, w: info.w, h: info.h },
            penalty: 0,
          }];
      labelRequests.push({
        id: `stage:${stage.id}`,
        kind: 'total',
        role: composedTextRole(info.text),
        owner: { categoryId: stage.id },
        text: info.text,
        lines: info.lines,
        font: strongFont,
        align: inside ? 'middle' as const : 'end' as const,
        priority:
          PRIORITY.total +
          (highlights.has(stage.id) ? PRIORITY.highlightBonus : 0),
        candidates,
      });
    }

    if (showStepCvr) {
      const stepText = stepTexts[categoryIndex]!;
      const stepSize = stepSizes[categoryIndex]!;
      labelRequests.push({
        id: `step-cvr:${stage.id}`,
        ...(categoryIndex > 0 && conversions.some(c => c.toId === stage.id) ? { claimId: `funnel:conv:${stages[categoryIndex - 1]!.id}:${stage.id}` } : {}),
        kind: 'point',
        role: composedTextRole(stepText),
        owner: { categoryId: stage.id },
        text: stepText,
        lines: [stepText],
        font: labelFont,
        priority: PRIORITY.extreme,
        // A named column's values are its content: the density gate keeps them with the head.
        keepWhenDense: true,
        candidates: [{
          slot: 'stepCvrColumn',
          rect: { x: flushRight(stepX, stepBlockWidth, stepSize.width), y: yTop + bandHeight / 2 - stepSize.height / 2, w: stepSize.width, h: stepSize.height },
          penalty: 0,
        }],
      });
    }

    if (showTotalCvr && labelOn('point')) {
      const cvrText = cvrTexts[categoryIndex]!;
      const cvrSize = cvrSizes[categoryIndex]!;
      labelRequests.push({
        id: `total-cvr:${stage.id}`,
        ...(cumulativeCvrs[categoryIndex]!.rate !== null ? { claimId: `funnel:total-cvr:${stage.id}` } : {}),
        kind: 'point',
        role: composedTextRole(cvrText),
        owner: { categoryId: stage.id },
        text: cvrText,
        lines: [cvrText],
        font: cvrFont,
        priority: PRIORITY.extreme,
        keepWhenDense: true,
        candidates: [{
          slot: 'cvrColumn',
          rect: {
            x: flushRight(cvrX, cvrBlockWidth, cvrSize.width),
            y: yTop + bandHeight / 2 - cvrSize.height / 2,
            w: cvrSize.width,
            h: cvrSize.height,
          },
          penalty: 0,
        }],
      });
    }
  });

  if (showStepCvr && labelOn('annotation')) {
    labelRequests.push({
      id: 'step-cvr:header',
      kind: 'annotation', role: 'caption',
      ...(spanForm ? { pad: 0 } : {}),
      owner: { annotationId: 'step-cvr-header' },
      text: stepHeaderText,
      lines: headLines(stepHeaderText),
      font: headerFont,
      priority: PRIORITY.total,
      align: 'end' as const,
      candidates: [{ slot: 'cvrHeader', rect: { x: flushRight(stepX, stepBlockWidth, stepHeaderSize.width), y: headY(stepHeaderSize.height), w: stepHeaderSize.width, h: stepHeaderSize.height }, penalty: 0 }],
    });
  }

  if (spanForm) {
    labelRequests.push({
      id: CVR_SPAN_HEADER,
      kind: 'annotation', role: 'caption',
      owner: { annotationId: 'cvr-span-header' },
      text: spanText,
      lines: [spanText],
      font: headerFont,
      priority: PRIORITY.total,
      align: 'end',
      // The two head rows touch; their line height keeps the air between them.
      pad: 0,
      // Flush right over the total column; a longer head reaches left over the
      // empty head row above the funnel and never widens the columns.
      candidates: [{ slot: 'cvrHeader', rect: { x: Math.max(inner.x, cvrX + cvrBlockWidth - colPad - spanSize.width), y: inner.y, w: spanSize.width, h: spanSize.height }, penalty: 0 }],
    });
  }

  if (showTotalCvr && labelOn('annotation')) {
    labelRequests.push({
      id: 'total-cvr:header',
      kind: 'annotation', role: 'caption',
      ...(spanForm ? { pad: 0 } : {}),
      owner: { annotationId: 'total-cvr-header' },
      text: cvrHeaderText,
      lines: headLines(cvrHeaderText),
      font: headerFont,
      priority: PRIORITY.total,
      align: 'end' as const,
      candidates: [{
        slot: 'cvrHeader',
        rect: {
          x: flushRight(cvrX, cvrBlockWidth, cvrHeaderSize.width),
          y: headY(cvrHeaderSize.height),
          w: cvrHeaderSize.width,
          h: cvrHeaderSize.height,
        },
        penalty: 0,
      }],
    });
  }

  for (const request of labelRequests) {
    const categoryId = request.owner.categoryId;
    if (categoryId === undefined) continue;
    const categoryIndex = stages.findIndex((stage) => stage.id === categoryId);
    request.candidates = request.candidates.filter((candidate) =>
      rectContains(rowLanes[categoryIndex]!, candidate.rect),
    );
  }
  stages.forEach((stage, categoryIndex) => {
    occupied.claim(
      rowLanes[categoryIndex]!,
      'mark',
      { categoryId: stage.id },
      'funnel-row-lane',
    );
  });

  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: 2,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) {
    // Name bold over the value in the regular face.
    if (label.id.startsWith('stage:') && label.lines.length > 1) {
      label.font = labelFont;
      label.headLines = 1;
      label.headWeight = emphasisWeight(theme);
    }
    if (label.id.startsWith('total-cvr:') && label.id !== 'total-cvr:header') label.font = cvrFont;
    // The column heads are furniture, in the muted ink.
    if (label.id === 'step-cvr:header' || label.id === 'total-cvr:header' || label.id === CVR_SPAN_HEADER) label.ink = { token: 'inkMuted' };
  }
  // A column head never prints without its values: it goes with them.
  for (const column of ['step-cvr', 'total-cvr']) {
    const values = solved.placed.filter((label) => label.id.startsWith(`${column}:`) && label.id !== `${column}:header`);
    const head = solved.placed.find((label) => label.id === `${column}:header`);
    if (head && !head.hidden && values.length > 0 && values.every((label) => label.hidden)) head.hidden = values[0]!.hidden;
  }
  // The spanning head goes with its two column heads.
  const span = solved.placed.find((label) => label.id === CVR_SPAN_HEADER);
  const columnHeads = solved.placed.filter((label) => label.id === 'step-cvr:header' || label.id === 'total-cvr:header');
  if (span && !span.hidden && columnHeads.length > 0 && columnHeads.every((label) => label.hidden)) span.hidden = columnHeads[0]!.hidden;
  for (const label of solved.placed) {
    if (label.hidden !== 'collision' || label.owner.categoryId === undefined) continue;
    warnings.push({
      code: 'funnel-label-hidden',
      severity: 'warn',
      message: `label '${label.id}' could not stay in stage '${label.owner.categoryId}' without a collision — hidden`,
      owner: label.owner,
    });
  }

  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const normalized = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in normalized) || !normalized.categoryId) return null;
    const categoryIndex = stages.findIndex((stage) => stage.id === normalized.categoryId);
    if (categoryIndex < 0) return null;
    const stage = stages[categoryIndex]!;
    const nextIndex = Math.min(categoryIndex + 1, stages.length - 1);
    const y = rowsTop + (categoryIndex + 0.5) * bandHeight;
    let value = stageTotals[stage.id] ?? null;
    let boundaryX = axisX + (normalized.edge === 'start' ? -1 : 1) * boundaryWidths[stage.id]! / 2;
    let left = axisX - (boundaryWidths[stage.id]! + boundaryWidths[stages[nextIndex]!.id]!) / 4;
    let right = axisX + (boundaryWidths[stage.id]! + boundaryWidths[stages[nextIndex]!.id]!) / 4;
    if ('seriesId' in normalized && normalized.seriesId) {
      const seriesIndex = plotted.findIndex((series) => series.id === normalized.seriesId);
      if (seriesIndex < 0) return null;
      value = numbers.values[seriesIndex]![categoryIndex] ?? null;
      const topBefore = values
        .slice(0, seriesIndex)
        .reduce((sum, seriesValues) => sum + seriesValues[categoryIndex]!, 0);
      const bottomBefore = values
        .slice(0, seriesIndex)
        .reduce((sum, seriesValues) => sum + seriesValues[nextIndex]!, 0);
      const topLeft = axisX - boundaryWidths[stage.id]! / 2 + scaleValue(topBefore);
      boundaryX = topLeft + (normalized.edge === 'start' ? 0 : scaleValue(value ?? 0));
      const bottomLeft =
        axisX - boundaryWidths[stages[nextIndex]!.id]! / 2 + scaleValue(bottomBefore);
      left = (topLeft + bottomLeft) / 2;
      right =
        left +
        (scaleValue(values[seriesIndex]![categoryIndex]!) +
          scaleValue(values[seriesIndex]![nextIndex]!)) /
          2;
    }
    if (value === null) return null;
    return {
      x: normalized.edge === 'start' ? left : right,
      y,
      comparisonPoint: { x: boundaryX, y: rowsTop + categoryIndex * bandHeight },
      row: { y: rowsTop + categoryIndex * bandHeight, h: bandHeight },
      value,
      date: stage.date, label: stage.label,
      owner: { categoryId: stage.id, ...(normalized.seriesId ? { seriesId: normalized.seriesId } : {}) },
    };
  };
  const annotationOccupied = createOccupiedIndex({
    x: 0,
    y: 0,
    w: size.width,
    h: size.height,
  });
  // The columns right of the bracket are not in its lane: a leg measured
  // past them would run out to the canvas edge and point at their figures.
  const columnRects = new Set(solved.placed
    .filter((label) => cagrReserve > 0 && /^(step|total)-cvr:/.test(label.id))
    .map((label) => JSON.stringify(label.rect)));
  const annotationSeed = occupied
    .snapshot()
    .filter((claim) => claim.part !== 'funnel-row-lane' && !(claim.kind === 'label' && columnRects.has(JSON.stringify(claim.rect))));
  for (const claim of annotationSeed) {
    annotationOccupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
  }
  const annotationResult = runAnnotatePass({
    annotations: (options.annotations ?? []) as Annotation[],
    valueAxis: 'horizontal',
    defaultSpan: stages.length > 1 ? { from: stages[0]!.id, to: stages.at(-1)!.id } : undefined,
    resolve,
    occupied: annotationOccupied,
    plot,
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    solveCtx,
  });
  pushAll(warnings, annotationResult.warnings);
  for (const claim of annotationOccupied.snapshot().slice(annotationSeed.length)) {
    occupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
  }

  const allLabels: PlacedLabel[] = [...solved.placed, ...annotationResult.labels];
  pushAll(nodes, annotationResult.nodes);
  pushAll(nodes, centeredLabelNodes(theme, allLabels, strongFont, headerFont, labelFont, nodes));
  // a hairline under the column heads closes the table head.
  const heads = allLabels.filter((label) => !label.hidden && (label.id === 'step-cvr:header' || label.id === 'total-cvr:header'));
  if (heads.length > 0) {
    const ruleY = Math.round(Math.max(...heads.map((label) => label.rect.y + label.rect.h)) + 3) + 0.5;
    const left = showStepCvr ? stepX : cvrX;
    const right = Math.max(...heads.map((label) => label.rect.x + label.rect.w));
    if (ruleY < rowsTop) nodes.push({ t: 'line', id: 'cvr:header-rule', x1: left, y1: ruleY, x2: right, y2: ruleY, stroke: { token: 'grid' }, width: strokeToken(theme, 'hair'), owner: {}, part: 'gridline' });
  }

  const a11yParts = stages.map((stage, categoryIndex) => {
    const stageCvr = stageCvrText(categoryIndex);
    const totalCvr = cumulativeCvrText(cumulativeCvrs[categoryIndex]!.rate);
    return chartString(options, 'stageCvrDesc', { v1: stage.label, v2: numbers.shownTotals[stage.id] == null ? chartString(options, 'missing') : totalFmt(numbers.shownTotals[stage.id]!), v3: stageCvr, v4: totalCvr });
  });
  const first = stages[0]!;
  const last = stages[stages.length - 1]!;

  const tallestStageLabelH = Math.max(0, maxOf(stageLabelInfos.map((label) => label.h)));
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, centeredAdjacentWarnings(marks, nodes, values, plotted, theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  return {
    type: 'funnel',
    size,
    // Rows share one pitch, so the tallest stage label sizes them: a hidden value makes only its own label one line.
    sizing: rowSizing('funnel', size, {
      chromeH: size.height - rowsHeight,
      minimumRowsH: stages.length * Math.max(28, labelOn('total') ? tallestStageLabelH + 6 : 0),
      // A wide card gets air around each stage (pitch 56 at 960, 52 at 720, 40 at 480, 36 at 400): 0.05 px of air
      // per px of canvas over 400, up to 19 px.
      naturalRowsH: stages.length * (Math.max(28, labelOn('total') ? tallestStageLabelH + 6 : 0)
        + clamp((size.width - 400) * 0.05, 0, 19)),
      // The frame, the funnel at its narrowest readable width, the stage
      // labels it sends outside, and the CVR columns.
      // The funnel width plus the labels it sends outside, at the narrowest sum.
      minWidth: size.width - inner.w + cagrReserve + stepBlockWidth + cvrBlockWidth + narrowestFunnel,
    }),
    plot,
    scene: nodes,
    labels: allLabels,
    axes: [{
      axis: 'y',
      ticks: stages.map((stage, categoryIndex) => ({
        at: stage.id,
        pos: rowsTop + (categoryIndex + 0.5) * bandHeight,
        labelId: labelOn('total') ? `stage:${stage.id}` : undefined,
      })),
    }],
    annotations: annotationResult.placed,
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: {
      stageTotals,
      conversions,
      ...(worstDrop ? { worstDrop } : {}),
      cumulativeCvrs,
      boundaryWidths,
    },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'funnelTitle', { v1: first.label, v2: last.label })),
      desc: chartString(options, 'centeredFunnelDesc', { v1: stages.length, v2: a11yParts.join('; ') }),
    },
    warnings,
    paintWarningRules,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annotationResult.decisions],
    },
  };

  function scaleValue(value: number): number {
    return maxTotal > 0 ? (value / maxTotal) * funnelWidth : 0;
  }

  function seriesPaint(series: Series, seriesIndex: number, stageIndex = 0): Paint {
    const ramp = rampFunnelPaint(theme, plotted, series, stageIndex, paletteRamp ? options.palette : undefined, stages.length);
    if (ramp) return ramp;
    if (series.fill) return { css: series.fill };
    if (series.colorRole) return markRolePaint(series.colorRole, true);
    // A single series leads in series 1, like any first series.
    return themeSeriesPaint(seriesIndex, paletteRamp ? options.palette : undefined);
  }

  function stagePaint(series: Series, seriesIndex: number, categoryIndex: number): Paint {
    const paint = seriesPaint(series, seriesIndex, categoryIndex);
    if (plotted.length !== 1 || stages.length === 1 || series.fill || series.colorRole || paletteRamp) return paint;
    if (rampFunnelPaint(theme, plotted, series, categoryIndex, undefined, stages.length)) return paint;
    return shadeStage(paint, categoryIndex, stages.length, options.stageShade);
  }

  function centeredPattern(series: Series): 'outline' | undefined {
    const scenario = normalizeScenario(series.scenario, `series[${series.id}].scenario`);
    if (scenario === 'FC') {
      if (!warnings.some((warning) => warning.code === 'funnel-centered-pattern-fallback')) {
        warnings.push({
          code: 'funnel-centered-pattern-fallback',
          severity: 'warn',
          message: "variant:'centered' renders FC stage faces with their existing solid paint because path hatching is unavailable",
        });
      }
      return undefined;
    }
    return scenario === 'PL' ? 'outline' : undefined;
  }
}

/** A trapezoid's midpoint width is the mean of its two declared boundaries. */
function centeredAdjacentWarnings(
  marks: FunnelMarks, nodes: readonly SceneNode[], values: readonly number[][],
  series: readonly Series[], theme: Theme, capture?: AdjacentWarningCapture,
): LintWarning[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const samples: (SeriesColorSample & AdjacentSeriesPaintSample)[] = [];
  marks.rows.forEach((row, categoryIndex) => {
    const nextIndex = Math.min(categoryIndex + 1, marks.rows.length - 1);
    let end = 0;
    series.forEach((series, seriesIndex) => {
      const from = end;
      end += (values[seriesIndex]![categoryIndex]! + values[seriesIndex]![nextIndex]!) / 2;
      const segment = row.segments.find((segment) => segment.id === series.id);
      const node = segment ? byId.get(segment.nodeId) : undefined;
      if (node?.t !== 'path' || !node.fill) return;
      const paint = 'token' in node.fill && node.fill.token === 'background' && node.stroke ? node.stroke : node.fill;
      samples.push({ seriesId: series.id, categoryId: row.categoryId, from, to: end, paint, css: paintColor(theme, paint), highlighted: false });
    });
  });
  retainAdjacentWarningRule(samples, true, capture);
  return adjacentSeriesWarnings(samples, true, theme);
}

function quadrilateralPath(
  topLeft: number,
  topRight: number,
  bottomRight: number,
  bottomLeft: number,
  yTop: number,
  yBottom: number,
): string {
  return `M ${topLeft} ${yTop} L ${topRight} ${yTop} L ${bottomRight} ${yBottom} L ${bottomLeft} ${yBottom} Z`;
}
