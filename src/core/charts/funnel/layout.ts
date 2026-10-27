import { chartString } from '../../strings/funnel';
import { chartPalette, chartTheme } from '../chartEnv';
import { labelOn as chartLabelOn } from '../labelOn';
import { structureCount } from '../../structureCounts';
import type { PaintWarningRule } from '../../types/scene';
/**
 * Funnel — stage-flow lead funnel (type 'funnel').
 *
 * Categories are the funnel stages (top→down rows); series are the outcome
 * segments (colorRole 'status-*'). Each stage row is a horizontal stacked bar
 * of its outcome segments, all sharing ONE x scale anchored at 0 (left-
 * aligned; total row width = stage total).
 *
 * The library DERIVES stage totals and stage→stage conversion rates — never
 * trusted from the caller. Conversion is always next stage total ÷ current
 * stage total. Conversion capsules belong to the source row and occupy its
 * outbound lane immediately below the row; their wording names both stages.
 * The worst stage→stage drop-off gets an automatic 'note' annotation unless
 * the caller already supplies one.
 */

import type { AnchorResolution } from '../../annotate';
import { runAnnotatePass } from '../../annotatePass';
import { rectSeriesAdjacentWarnings } from '../../adjacentSeries';
import { warnSpreadOverflow } from '../../collide';
import { formatAutomaticNumber, formatAutomaticPercent, smallRateDecimals } from '../../format';
import { formatterFromExample, seriesRasterFormatter } from '../../formatSpec';
import { cellMeta } from '../../types/cell';
import type { Rect } from '../../geometry';
import { clamp, rectContains, rectsOverlap } from '../../geometry';
import { createOccupiedIndex } from '../../label/occupied';
import { labelsToNodes, SWATCH_RESERVE } from '../../label/emit';
import { isOthersFill, othersSeparation, withSegmentSeams } from '../../markVisibility';
import {
  labelCtx,
  PRIORITY,
  solveLabels,
  type LabelRequest,
  type SlotCandidate,
  type SolveCtx,
} from '../../label/solver';
import { accessibleTitle,
  NormalizeError,
  normalizeCategory,
  normalizeSeriesValues,
  normalizeScenario,
  resolveHighlight,
  resolveSize,
} from '../../normalize/shared';
import { linearScale } from '../../scale';
import { authoredNotes, frameTextOptions, normalizeLegendOption, solveFrame, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import { rowSizing } from '../../sizing';
import { defaultMeasurer, type FontSpec } from '../../text';
import {
  canvasMargin,
  effectiveFill,
  markRolePaint,
  paintColor,
  seriesPaint as themeSeriesPaint,
  emphasisWeight,
} from '../../theme';
import type { AnchorRef, Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { ChartData, Series } from '../../types/data';
import type { FunnelOptions, LabelKind } from '../../types/options';
import type { SlotId } from '../../types/cell';
import type {
  Geometry,
  LintWarning,
  Paint,
  PlacedAnnotation,
  PlacedLabel,
  SceneNode,
} from '../../types/scene';
import { layoutCenteredFunnel, rampFunnelPaint, shadeStage } from './centered';
import { funnelComparisonLayout } from './comparisons';
import { clampedNote, deriveFunnel, funnelValueFormats, missingGlyph } from './derive';
import { INSIDE_MIN_H, INSIDE_MIN_W } from '../band/labels';
import { barWidthForOutsideValues, OUTSIDE_GAP, outsideStart, outsideWidth } from './outsideValues';
import { belowCalloutCandidates, dropCallout, fitText, type FittedText, LABEL_PAD, laneY, LANE_PAD, lineHeight, rowGapFraction, type DropCallout } from './rowsText';
import { composedTextRole } from '../../textRole';
import { footnoteSuffix } from '../../footnoteMark';
import { maxOf, pushAll } from '../../arrays';

export interface FunnelMarks {
  rows: {
    categoryId: Id;
    rect: Rect;
    lane: Rect;
    segments: { id: Id; rect: Rect; nodeId: Id }[];
  }[];
}

export interface FunnelDerived {
  /** Null where a series misses the stage: the total is not known. */
  stageTotals: Record<Id, number | null>;
  conversions: { fromId: Id; toId: Id; rate: number }[];
  worstDrop?: { fromId: Id; toId: Id; rate: number };
  cumulativeCvrs?: { stageId: Id; rate: number | null }[];
  boundaryWidths?: Record<Id, number>;
}

const CAT_LABEL_LINES = 2;
/** The longest bar is never shorter than this; the stage widths read against it. */
const MIN_LONGEST_BAR = 96;
/** The room an inside segment value keeps on each side. */
const INSIDE_SIDE_PAD = 4;
/** Space between the widest bar end (or its total) and the conversion column. */
const CONVERSION_GAP = 12;
/** How far inside the bar end a callout's leader lands. */
const CALLOUT_INSET = 10;
/** Space between a row's last printed value and the drop callout beside it. */
const CALLOUT_GUTTER = 12;
/** Chip values: space between two chip columns. */
const CHIP_GAP = 14;
/** Space between the bar and the chip line under it. */
const CHIP_BAR_GAP = 6;
/** Space between the longest bar's total and the chip block right of the bars. */
const CHIP_BLOCK_GAP = 16;
/** The chip block goes right of the bars only while the bars keep this share of their room. */
const CHIP_RIGHT_SHARE = 0.6;
/** Bar thickness of chip rows: wide frames, and card plots narrower than CARD_PLOT_W. */
const CHIP_BAR = 26;
const CHIP_BAR_CARD = 24;
const CARD_PLOT_W = 440;
/** Space above and below a step caption in the natural row step. */
const CHIP_CAPTION_PAD = 12;
/** How far the highlight band reaches above the bar, and past the plot edges. */
const CHIP_TINT_PAD = 8;
const CHIP_TINT_OUTSET = 6;

function rowOptionWarnings(options: FunnelOptions): LintWarning[] {
  const warnings: LintWarning[] = [];
  if (options.totalCvr === 'column') {
    warnings.push({
      code: 'funnel-total-cvr-centered-only',
      severity: 'warn',
      message: "funnel totalCvr:'column' requires variant:'centered' — ignored",
    });
  }
  if (options.stageShade !== undefined) {
    warnings.push({
      code: 'funnel-stage-shade-centered-only',
      severity: 'warn',
      message: "funnel stageShade requires variant:'centered'; row paints remain unchanged",
    });
  }
  return warnings;
}

/** A smaller |value| ranks lower, so a crowded row drops its smallest value first. */
function segmentLabelPriority(value: number, maxAbs: number, highlighted: boolean): number {
  return PRIORITY.interior + (maxAbs > 0 ? Math.round((99 * Math.abs(value)) / maxAbs) : 0) +
    (highlighted ? PRIORITY.highlightBonus : 0);
}

export function layoutFunnel(
  data: ChartData,
  options: FunnelOptions = {},
): Geometry<FunnelMarks, FunnelDerived> {
  if (options.variant === 'centered') return layoutCenteredFunnel(data, options);
  const warnings = rowOptionWarnings(options);
  const theme = chartTheme(options);
  const paletteRamp = chartPalette(theme, options.palette, warnings);
  const size = resolveSize(options.size);
  const measure = options.measure ?? defaultMeasurer;
  // Business default (copied from waterfall): whole numbers get 0 decimals;
  // small non-integers keep one, so a 0.4 sliver never prints as "0".
  const autoDecimals = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? 0 : 1);
  const fmt = options.format
    ? formatterFromExample(options.format, options.locale?.language)
    : (v: number) => formatAutomaticNumber(v, { locale: options.locale?.language, decimals: autoDecimals(v) });
  const fmtPct = (rate: number) => {
    const pct = rate * 100;
    return formatAutomaticPercent(pct, smallRateDecimals(pct), false, options.locale?.language);
  };
  const highlights = new Set(resolveHighlight(options.highlight));
  const labelsOpt = options.labels;
  const labelOn = (kind: LabelKind): boolean => chartLabelOn(options, kind);

  // ---- normalize ----
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new NormalizeError('empty-data', 'categories', 'funnel requires at least one stage');
  }
  if (!Array.isArray(data.series) || data.series.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'funnel requires at least one series');
  }
  const stages = data.categories.map((c, i) => normalizeCategory(c as never, i));
  const plotted = data.series.filter((s) => s.role !== 'reference');
  if (plotted.length === 0) {
    throw new NormalizeError('empty-data', 'series', 'funnel requires at least one data-role series');
  }
  const { values, known, stageTotals, shownTotals, conversions, worstDrop, undefinedSteps, clamped } = deriveFunnel(plotted, stages, fmt, warnings);
  const glyph = missingGlyph(theme);
  const cells = plotted.map((series, si) => normalizeSeriesValues(series, stages, si));
  // One raster per stage: the values of one stage share one decimal count, and a stage of whole counts prints none.
  // A single series is one raster down its stages (one decimal count within a series).
  const formats = stages.map((_, ci) => seriesRasterFormatter(options.format, plotted.length === 1 ? values[0]! : plotted.map((_, si) => values[si]![ci]), options.locale?.language, options.unit, options.target, undefined, true));
  // Totals and series without format metadata print through the shared raster (one decimal count, engine scale).
  const totalRaster = seriesRasterFormatter(options.format, Object.values(stageTotals), options.locale?.language, options.unit, options.target);
  // A whole count prints whole beside fractional values of its stage ("140", "1" beside "0.6"); an amount like 100.4 keeps its decimals.
  if (!options.format) for (const format of [...formats, totalRaster]) format.spec.wholeCounts = true;
  const { valueText, totalFmt } = funnelValueFormats(plotted, cells, formats, totalRaster);
  const cellText = (si: number, ci: number, value: number): string | null => {
    const label = cellMeta(cells[si]![ci]!)?.label;
    return label === false ? null : typeof label === 'string' ? label.replace(/\$\{value\}/g, valueText(si, ci, value)) : valueText(si, ci, value);
  };


  // ---- frame ----
  const occupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const margin = { ...canvasMargin(theme, size.width), ...options.margin };
  // A stage split into several series names them in a key above the
  // plot unless the author turned the key off.
  const legendOpts = normalizeLegendOption(options.legend, plotted.length > 1 ? { position: 'top' } : undefined);
  const legendItems: LegendItemInput[] = plotted.map((s, si) => ({
    id: s.id,
    label: s.label ?? s.id,
    paint: seriesPaint(s, si),
    pattern: seriesPattern(s),
  }));
  if (legendOpts?.order) {
    const rank = new Map(legendOpts.order.map((id, i) => [id, i]));
    legendItems.sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
  }
  // Emphasis is never a key entry. A highlighted stage changes its
  // row (bold name, tint band, bold outgoing caption), and `legend: 'none'`
  // draws no key at all.
  const keyed = legendOpts ? { options: legendOpts, items: legendItems } : undefined;
  const frameResult = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [...authoredNotes(options), ...clampedNote(clamped, options)],
      legend: keyed,
      theme,
      measure,
    },
    occupied,
  );
  const inner = frameResult.plot;
  const innerRight = inner.x + inner.w;

  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  // A step caption is derived text, set one text step under the values in
  // the caption size the theme gives its notes.
  const captionFont: FontSpec = { family: theme.type.family, ...theme.type.footnote };
  const captionStrong: FontSpec = { ...captionFont, weight: emphasisWeight(theme) };
  const tickStrong: FontSpec = { ...tickFont, weight: emphasisWeight(theme) };
  const highlightedStep = (fromId: Id): boolean => highlights.has(fromId);

  // ---- reserved bands: stage labels LEFT (measured), stage totals RIGHT ----
  // The compact form (a card narrower than the full chart measures)
  // narrows the label column, so stage names wrap sooner.
  const compactForm = options.mode === 'compact';
  const catCap = compactForm ? Math.max(40, inner.w * 0.18) : Math.max(50, inner.w * 0.24);
  // The stage name is fitted to its band MINUS the footnote mark, and the
  // mark goes on after: an ellipsis takes the tail of the name and never
  // the reference the reader follows.
  const catMarkOf = (c: (typeof stages)[number]): string =>
    footnoteSuffix(c.footnote, c.id, { count: authoredFootnoteCount(options), warnings });
  const catNameOf = (c: (typeof stages)[number]): string => c.label ?? c.id;
  const catLabelOf = (c: (typeof stages)[number]): string => `${catNameOf(c)}${catMarkOf(c)}`;
  // The highlighted stage's name is set bold.
  const catFont = (c: (typeof stages)[number]): FontSpec => (highlights.has(c.id) ? tickStrong : tickFont);
  const withCatMark = (fitted: FittedText, c: (typeof stages)[number]): FittedText => {
    const mark = catMarkOf(c);
    if (!mark) return fitted;
    const lines = [...fitted.lines];
    lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${mark}`;
    return { ...fitted, lines, w: fitted.w + measure(mark, catFont(c)).width };
  };
  const fitCatName = (c: (typeof stages)[number], maxWidth: number, maxLines: number): FittedText =>
    withCatMark(fitText(catNameOf(c), catFont(c), Math.max(1, maxWidth - (catMarkOf(c) ? measure(catMarkOf(c), catFont(c)).width : 0)), maxLines, measure, { target: options.target, typeRole: 'axis' }), c);
  const catInfo = stages.map((c) => fitCatName(c, catCap, CAT_LABEL_LINES));
  const bandW = labelOn('category') ? maxOf(catInfo.map((c) => c.w)) + 14 : 0;
  const totalTexts = stages.map((c, ci) => { const total = shownTotals[c.id] ?? null; return total === null ? glyph : plotted.length === 1 ? cellText(0, ci, total) ?? '' : totalFmt(total); });
  const totalSizes = totalTexts.map((t) => measure(t, strongFont));
  const totalReserve = labelOn('total')
    ? maxOf(totalSizes.map((t) => t.width)) + 14
    : 8;

  // "Biggest drop" callout, opt-in through worstDropCallout: the
  // engine renders authored text and composes none, and the step caption
  // already prints the rate. Its own column, reserved BEFORE the bars are
  // sized, and never the slot a value label sits in. It wraps to a narrower
  // column rather than cutting a stage name, and only a column it cannot
  // afford at all sends it under the bar.
  let callout: DropCallout | null = null;
  if (worstDrop && options.worstDropCallout === true && labelsOpt !== false && !(options.annotations ?? []).some((a) => a.kind === 'note')) {
    callout = dropCallout(
      formatAutomaticNumber((1 - worstDrop.rate) * 100, { locale: options.locale?.language, decimals: 0 }),
      stages.find((c) => c.id === worstDrop!.fromId)?.label ?? worstDrop.fromId,
      stages.find((c) => c.id === worstDrop!.toId)?.label ?? worstDrop.toId,
      labelFont,
      measure,
      // Captions live right of the baseline: their width is the row right of the label band.
      { innerW: inner.w, avail: inner.w - bandW - totalReserve, captionW: inner.w - bandW - 8, besideCaption: labelOn('point') },
      options,
    );
  }
  const noteReserve = callout?.reserve ?? 0;

  // The step conversion stands in the gap between its two rows, just
  // right of the baseline, so "44% advance" sits between the bars it links
  // instead of a column hundreds of pixels away. It names the share that
  // moves on, since a bare "↓ 44%" reads as a 44 % drop. The rows keep a gap
  // tall enough for it (rowGapFraction below).
  // Out of a stage of zero no share advances; the gap says so.
  const steps = [
    ...conversions.map((conv) => ({ ...conv, text: conv.rate > 1 ? chartString(options, 'stageIncreased') : chartString(options, 'stageAdvance', { v1: fmtPct(conv.rate) }) })),
    ...undefinedSteps.map((step) => ({ ...step, text: chartString(options, 'previousStageZero') })),
  ];
  const captions = new Map(labelOn('point') ? steps.map(({ fromId, text }) => {
    const font = highlightedStep(fromId) ? captionStrong : captionFont;
    const caption: FittedText = { lines: [text], w: measure(text, font).width, h: lineHeight(font) };
    return [fromId, caption] as const;
  }) : []);
  const convColW = Math.max(0, maxOf([...captions.values()].map((c) => c.w)));
  const convRight = innerRight - noteReserve - 2;

  const x0 = inner.x + bandW;
  const rowsTop = inner.y + 4;
  // The gaps between rows belong to the step captions, so an authored diff
  // gets a band under the last row for its arrow, and a delta or abs on the
  // last stage a line under its bar end. Without the band they would cross
  // the captions or be hidden at the natural height.
  const authoredKinds = new Set((options.annotations ?? []).map((a) => a.kind));
  const arrowBandH = authoredKinds.has('diff') ? Math.ceil(lineHeight(labelFont) + 14) : 0;
  const annotationBandH = arrowBandH +
    (authoredKinds.has('delta') || authoredKinds.has('abs') ? Math.ceil(lineHeight(labelFont) + 10) : 0);
  // A short pinned frame with an annotation band leaves the rows no room.
  // They keep a 10 px strip and the sizing below asks for the height they
  // need, so the gate refuses or grows the canvas instead of a layout error.
  const rowsSpace = inner.y + Math.max(14, inner.h) - 4 - annotationBandH - rowsTop;
  const rowsH = Math.max(10, rowsSpace);
  const rowsBottom = rowsTop + rowsH;

  // Row bands: widen the inter-row gap enough for the conversion caption
  // level with it when the default band fraction would squeeze it out;
  // capped so bars stay readable.
  const convProbe = measure(chartString(options, 'advanceProbe'), captionFont);
  const bf = options.bandFraction ?? 0.68;
  const piBase = 1 - bf;
  const stepApprox = rowsH / stages.length;
  const maxTotal = Math.max(0, maxOf(known));
  const maxAbsValue = Math.max(0, maxOf(values.flat().map((v) => Math.abs(v ?? 0))));
  // Without a column the callout stands under its step caption: the gap then
  // holds both, and the natural height makes room for them.
  const worstCaption = callout && !callout.column && labelOn('point') ? captions.get(worstDrop!.fromId) : undefined;
  const calloutStackH = worstCaption ? callout!.below.h + LABEL_PAD : 0;
  const shownCaptions = [...captions.values()].map((c) => ({ ...c, h: c.h + (c === worstCaption ? calloutStackH : 0) }));
  const multi = plotted.length > 1;
  const captionOnlyBandH = Math.max(convProbe.height, maxOf(shownCaptions.map((c) => c.h)));
  // a total annotation hangs below its bar and must fit in the lower half of the row gap.
  const totalAnnotationGap = (options.annotations ?? []).some(ann =>
    (ann.kind === 'delta' || ann.kind === 'abs') && totalAnchorStage(ann.at) >= 0)
    ? 2 * (measure('0', labelFont).height + 6) : 0;
  // The gap widens only for captions that print; without them the
  // band fraction is the authored one.
  const captionBandH = captions.size > 0 || totalAnnotationGap > 0 ? Math.max(captionOnlyBandH, totalAnnotationGap) : 0;
  const pi = captionBandH > 0 ? rowGapFraction(stages.length, stepApprox, captionBandH, piBase) : piBase;
  // An authored bandFraction acts: the natural height makes the step tall
  // enough for the captions at that fraction (see naturalRowsH). Where a
  // pinned height cannot, the gap the captions need wins and the warning says so.
  const authoredFraction = options.bandFraction !== undefined;
  if (authoredFraction && pi > piBase + 1e-6) {
    warnings.push({
      code: 'funnel-band-fraction-overridden', severity: 'warn',
      message: `bandFraction ${bf} leaves the step captions no room at this height; the bars take ${Math.round((1 - pi) * 100)}% of each row. Give the chart more height, or drop bandFraction`,
    });
  }
  // a stage split into several outcomes prints every
  // segment value as a keyed chip in fixed columns, one column per series,
  // the same on every row. Wide frames keep the chips in a block right of the
  // bars, narrow frames on a line under each bar, so the bars keep most of
  // the width.
  const chipMode = multi && labelOn('segment');
  const chips = chipMode ? chipColumns() : undefined;
  // Every rows funnel, single series included, draws thin bars at the top of
  // their steps, so a wide or tall frame never turns the bars into a poster.
  const barRoom = Math.max(10, inner.w - bandW - totalReserve - noteReserve);
  const chipsRight = chips !== undefined && barRoom - chips.blockW - CHIP_BLOCK_GAP >= CHIP_RIGHT_SHARE * barRoom;
  let chipPerLine = 1;
  let chipLines = 0;
  let chipUnderH = 0;
  /** Chip lines under the bars when `reserve` px at the right are taken. */
  const setChipLines = (reserve: number): void => {
    chipPerLine = chips === undefined ? 1 : chipsRight ? plotted.length
      : Math.max(1, Math.floor((innerRight - noteReserve - reserve - 2 - x0 + CHIP_GAP) / chips.pitch));
    chipLines = chips === undefined || chipsRight ? 0 : Math.ceil(plotted.length / chipPerLine);
    chipUnderH = chipLines > 0 ? CHIP_BAR_GAP + chipLines * chips!.lineH : 0;
  };
  setChipLines(0);
  const chipIsRedundant = (ci: number, drawn: number, text: string): boolean =>
    drawn === 1 && labelOn('total') && stageTotals[stages[ci]!.id] != null && text === totalTexts[ci];
  // A one-segment row still needs chip space when its text differs from the total.
  const chipsOnRow = (ci: number): boolean => {
    if (chipLines === 0) return false;
    const drawn = plotted.filter((_s, si) => (values[si]![ci] ?? 0) > 0).length;
    if (drawn !== 1) return drawn > 1;
    return plotted.some((_s, si) => {
      const value = values[si]![ci];
      if (value == null || value <= 0) return false;
      const text = cellText(si, ci, value);
      return !!text && !chipIsRedundant(ci, drawn, text);
    });
  };
  let band = chipRowBand();
  /** Height under a bar the chip line takes on that row. */
  const underH = (ci: number): number => (chipsOnRow(ci) ? chipUnderH : 0);
  // A gap too short for a caption and its label padding (a squeezed, pinned
  // frame) keeps the conversion column at the right, reserved before the bars are
  // sized.
  const inGap = band.step - band.bandwidth - chipUnderH >= captionBandH + 2 * LABEL_PAD;
  const convReserve = !inGap && convColW > 0 ? convColW + CONVERSION_GAP : 0;
  // The chip line under the bars stays left of that column.
  if (chipMode && chipLines > 0 && convReserve > 0) {
    setChipLines(convReserve);
    band = chipRowBand();
  }
  const barW0 = Math.max(10, inner.w - bandW - totalReserve - noteReserve - convReserve);
  const chipLimit = innerRight - noteReserve - convReserve - 2;
  const chipX0 = chips === undefined ? x0 : chipsRight ? chipLimit - chips.blockW : x0;

  // segment labels only when >1 outcome series (redundancy gate: a
  // single-series row never prints segment value + identical total)
  // Width: the text plus its padding. Height: the type size, not the line
  // box — a 13px numeral reads inside a 15px bar, and measuring the box
  // instead pushed every value of a thin row outside.
  // The first segment also clears the baseline, which reaches 1px into it.
  // The inside-label floor (28 x 14 px) holds here as in every band chart.
  // An inside value keeps 4 px on each side.
  const fitsInside = (textW: number, segmentW: number, first: boolean): boolean =>
    textW + 2 * INSIDE_SIDE_PAD + (first ? 2 : 0) <= segmentW && labelFont.size <= band.bandwidth &&
    segmentW >= INSIDE_MIN_W && band.bandwidth >= INSIDE_MIN_H;
  const barW = chipMode ? Math.max(10, chipsRight ? barW0 - chips!.blockW - CHIP_BLOCK_GAP : barW0) : barWidthForOutsideValues({
    barW: barW0, x0, limit: innerRight - noteReserve - convReserve - 2, maxTotal, fits: fitsInside,
    rows: stages.map((_c, ci) => ({
      total: known[ci]!,
      totalW: labelOn('total') ? totalSizes[ci]!.width : 0,
      segments: multi && labelOn('segment')
        ? plotted.flatMap((_s, si) => {
          const value = values[si]![ci] ?? null;
          const text = value === null ? null : cellText(si, ci, value);
          return text === null ? [] : [{ value: value!, textW: measure(text, labelFont).width }];
        })
        : [],
    })),
  });
  const xScale = linearScale([0, maxTotal || 1], [x0, x0 + barW]);
  const plot: Rect = { x: x0, y: rowsTop, w: barW, h: rowsH };
  const rowLanes = stages.map((_stage, ci): Rect => {
    const y = ci === 0 ? rowsTop : band.position(ci);
    const bottom = ci + 1 < stages.length ? band.position(ci + 1) : rowsBottom;
    return { x: inner.x, y, w: inner.w, h: Math.max(bottom - y, band.bandwidth) };
  });

  // ---- marks ----
  const nodes: SceneNode[] = [...frameResult.nodes];
  const marks: FunnelMarks = { rows: [] };
  const labelRequests: LabelRequest[] = [];

  // A highlighted stage keeps its fills and stands on a light tint band
  // across the row, behind every mark (as the dot chart tints a row). Decorative, not claimed.
  stages.forEach((cat, ci) => {
    if (!highlights.has(cat.id)) return;
    // Chip rows: the band holds the whole stage, its bar, chips and outgoing
    // caption, and reaches a little past the plot edges.
    const chipPad = Math.max(0, Math.min(CHIP_TINT_PAD, (band.step - band.bandwidth - chipUnderH - captionOnlyBandH) / 2 - LABEL_PAD));
    const tintTop = band.position(ci) - chipPad;
    const tintBottom = ci + 1 < stages.length ? band.position(ci + 1) - chipPad - LABEL_PAD : band.position(ci) + band.bandwidth + underH(ci) + chipPad;
    const outset = Math.min(CHIP_TINT_OUTSET, inner.x / 2);
    nodes.push({
      t: 'rect', id: `rowTint:${cat.id}`,
      rect: { x: inner.x - outset, y: tintTop, w: inner.w + 2 * outset, h: tintBottom - tintTop },
      fill: { token: 'others' }, owner: { categoryId: cat.id }, part: 'rowTint',
    });
  });

  const rowEnds: number[] = [];
  /** Where each row's printed values end: the total, then any values outside the bar. */
  const rowValueEnd = new Map<Id, number>();
  // cumEnd[ci][si] — pixel x of the right edge of segment si in stage ci
  const cumEnd: number[][] = stages.map(() => plotted.map(() => x0));

  interface SegLab {
    sid: Id;
    text: string;
    w: number;
    h: number;
    rect: Rect;
    cx: number;
    fits: boolean;
    fillCss: string;
    insidePaint: Paint;
    insidePattern?: 'hatch45' | 'outline';
    priority: number;
  }

  /**
   * Value labels of one row's segments. Inside the segment where it holds
   * the text, otherwise under the segment or, when no stage total is drawn,
   * outside the bar end; always in ink colour and never on a border. A value
   * on a border is unreadable and a leader to it reads as a minus sign, so
   * neither is offered. Under the segment they spread via spread1D.
   * Outside the bar end the displaced values stand in one line after the bar,
   * in segment order, and the bar width keeps room for that line
   * (outsideValues.ts). With a stage total drawn there is no such line: a
   * segment value after the total reads as part of the total ("410 90" for a
   * total of 410 and a segment of 90), so it goes under its own
   * segment or, where nothing is free there, is hidden with the label-hidden
   * warning while the accessible description keeps it.
   */
  function pushSegmentValues(row: {
    cat: { id: Id };
    segLabs: SegLab[];
    drawn: number;
    ry: number;
    bw: number;
    rowCy: number;
    rowEndX: number;
    lane: Rect;
    totalWidth: number;
  }): void {
    const { cat, segLabs, rowCy, rowEndX, lane } = row;
    if (segLabs.length === 0) return;
    // One placement per row. When one value of the row cannot stay inside
    // its segment, the whole row reads outside, in segment order.
    if (segLabs.some((l) => !l.fits)) for (const l of segLabs) l.fits = false;
    const outs = segLabs.filter((l) => !l.fits);
    // The displaced values first, in segment order; a value that fits inside
    // but loses its inside place to a collision queues up behind them.
    const outXs = new Map<SegLab, number>();
    const totalW = labelOn('total') ? row.totalWidth : 0;
    let cursor = outsideStart(rowEndX, totalW);
    const queue = (l: SegLab): void => {
      outXs.set(l, cursor);
      cursor += outsideWidth(l.w, totalW) + OUTSIDE_GAP;
    };
    outs.forEach(queue);
    if (outs.length > 0) rowValueEnd.set(cat.id, cursor - OUTSIDE_GAP);
    warnSpreadOverflow(warnings, cursor - OUTSIDE_GAP <= innerRight - 2, 'displaced segment labels exceed their row band even after spreading — labels stay bounded but overlap; fewer segments or a larger canvas fixes it');
    segLabs.filter((l) => l.fits).forEach(queue);

    segLabs.forEach((l) => {
      // The line after the bar end (and its total). Under the bar a value
      // reads as the next stage's, so there is no seat there.
      // Past the total the swatch keys the value to its segment,
      // whichever way it reached the slot: displaced, collided or pinned.
      const candidates: SlotCandidate[] = [{
        slot: 'outsideRight' as const,
        rect: { x: outXs.get(l)!, y: laneY(lane, rowCy, l.h), w: outsideWidth(l.w, totalW), h: l.h },
        penalty: 2,
        ...(totalW > 0 ? { swatch: l.insidePaint } : {}),
      }];
      if (l.fits) {
        candidates.unshift({
          slot: 'insideCenter',
          // Pad 0: an inside value belongs on its segment, so it is pushed
          // into the lane only far enough to stay out of the next row.
          rect: { x: l.cx - l.w / 2, y: laneY(lane, rowCy, l.h, 0), w: l.w, h: l.h },
          penalty: 0,
          insideFill: l.fillCss,
          insidePaint: l.insidePaint,
          insidePattern: l.insidePattern,
        });
      }
      labelRequests.push({
        id: `segment:${cat.id}:${l.sid}`,
        kind: 'segment',
        owner: { categoryId: cat.id, seriesId: l.sid },
        text: l.text,
        lines: [l.text],
        font: labelFont,
        priority: l.priority,
        // One drawn segment means the segment value IS the stage total, and
        // the bold total at the bar end already prints it, unless a missing
        // value left that total unknown.
        ...(row.drawn === 1 && labelOn('total') && stageTotals[cat.id] != null && l.text === totalTexts[stages.findIndex(stage => stage.id === cat.id)]
          ? { redundant: true, suppressedAs: 'redundant' as const }
          : {}),
        candidates,
      });
    });
  }

  /**
   * Chip values of one row: each value with its segment's
   * swatch, in its series' column, in ink and bold on a highlighted stage.
   * The block right of the bars stands level with the bar; the line under
   * the bar starts at the bar's left edge.
   */
  function pushChips(cat: { id: Id }, ci: number, rowChips: { si: number; sid: Id; text: string; paint: Paint; value: number }[], drawn: number): void {
    if (!chips || rowChips.length === 0) return;
    const lane = rowLanes[ci]!;
    const top = band.position(ci);
    const font = highlights.has(cat.id) ? strongFont : labelFont;
    let hasPrintedChip = false;
    for (const chip of rowChips) {
      const redundant = chipIsRedundant(ci, drawn, chip.text);
      hasPrintedChip ||= !redundant;
      const t = measure(chip.text, font);
      const line = chipsRight ? 0 : Math.floor(chip.si / chipPerLine);
      const col = chipsRight ? chip.si : chip.si % chipPerLine;
      const cy = chipsRight
        ? top + band.bandwidth / 2
        : top + band.bandwidth + CHIP_BAR_GAP + (line + 0.5) * chips.lineH;
      const y = laneY(lane, cy, t.height, 0);
      // The solver allows a label on its own mark. Reject a chip clamped
      // onto its bar so the existing omission warning reports the shortage.
      const fits = chipsRight || y >= top + band.bandwidth;
      labelRequests.push({
        id: `segment:${cat.id}:${chip.sid}`,
        kind: 'segment',
        owner: { categoryId: cat.id, seriesId: chip.sid },
        text: chip.text,
        lines: [chip.text],
        font,
        priority: segmentLabelPriority(chip.value, maxAbsValue, highlights.has(chip.sid) || highlights.has(cat.id)),
        ...(redundant ? { redundant: true, suppressedAs: 'redundant' as const } : {}),
        candidates: fits ? [{
          slot: chipsRight ? 'chipColumn' : 'chipLine',
          rect: { x: chipX0 + col * chips.pitch, y, w: t.width + SWATCH_RESERVE, h: t.height },
          penalty: 0,
          swatch: chip.paint,
        }] : [],
      });
    }
    // The row's printed values end after its chips: a drop callout beside the
    // row starts past them.
    if (hasPrintedChip) {
      const end = chipX0 + Math.min(plotted.length, chipPerLine) * chips.pitch - CHIP_GAP;
      rowValueEnd.set(cat.id, Math.max(rowValueEnd.get(cat.id) ?? end, end));
    }
  }

  stages.forEach((cat, ci) => {
    const ry = band.position(ci);
    const bw = band.bandwidth;
    const rowCy = ry + bw / 2;
    let cum = 0;
    const segRecs: FunnelMarks['rows'][number]['segments'] = [];
    const segLabs: SegLab[] = [];
    const rowChips: { si: number; sid: Id; text: string; paint: Paint; value: number }[] = [];

    plotted.forEach((s, si) => {
      const v = values[si]![ci] ?? null;
      if (v === null) {
        cumEnd[ci]![si] = xScale(cum);
        return; // a missing value: no mark, no label
      }
      const sx = xScale(cum);
      const ex = xScale(cum + v);
      cum += v;
      cumEnd[ci]![si] = ex;
      const w = ex - sx;
      // A zero segment has no mark and no label. A positive segment thinner
      // than a pixel keeps its mark, so its label is placed or its omission reported.
      if (v === 0) return;
      const rect: Rect = { x: sx, y: ry, w, h: bw };
      const nodeId = `mark:${cat.id}:${s.id}`;
      const segmentPaint = seriesPaint(s, si, ci);
      const sep = othersSeparation(segmentPaint, theme);
      nodes.push({
        t: 'rect',
        id: nodeId,
        rect,
        fill: segmentPaint,
        pattern: seriesPattern(s),
        ...(sep ? { stroke: sep.stroke, strokeWidth: sep.strokeWidth } : {}),
        ...(isOthersFill(segmentPaint) ? { separation: { fill: segmentPaint, backing: { token: 'background' } as const } } : {}),
        owner: { categoryId: cat.id, seriesId: s.id },
        part: 'segment',
        display: { value: valueText(si, ci, v) },
      });
      occupied.claim(rect, 'mark', { categoryId: cat.id, seriesId: s.id });
      segRecs.push({ id: s.id, rect, nodeId });

      const text = cellText(si, ci, v);
      if (chipMode && text) {
        rowChips.push({ si, sid: s.id, text, paint: segmentPaint, value: v });
      } else if (multi && labelOn('segment') && text) {
        const t = measure(text, labelFont);
        segLabs.push({
          sid: s.id,
          text,
          w: t.width,
          h: t.height,
          rect,
          cx: sx + w / 2,
          fits: fitsInside(t.width, w, segLabs.length === 0),
          fillCss: effectiveFill(seriesCss(s, si, ci), seriesPattern(s), theme),
          insidePaint: seriesPaint(s, si, ci),
          insidePattern: seriesPattern(s),
          priority: segmentLabelPriority(v, maxAbsValue, highlights.has(s.id) || highlights.has(cat.id)),
        });
      }
    });

    const rowEndX = xScale(known[ci]!);
    rowEnds.push(rowEndX);
    rowValueEnd.set(cat.id, labelOn('total') ? rowEndX + 6 + totalSizes[ci]!.width : rowEndX);
    marks.rows.push({
      categoryId: cat.id,
      rect: { x: x0, y: ry, w: Math.max(rowEndX - x0, 0), h: bw },
      lane: rowLanes[ci]!,
      segments: segRecs,
    });

    // ---- stage total at the right end of the bar, in bold ----
    const totText = totalTexts[ci]!;
    const totSize = totalSizes[ci]!;
    const lane = rowLanes[ci]!;
    if (labelOn('total') && totText) {
      const slotAt = (desiredCy: number, slot: SlotId, penalty: number): SlotCandidate => ({
        slot,
        rect: {
          x: rowEndX + 6,
          y: laneY(lane, desiredCy, totSize.height),
          w: totSize.width,
          h: totSize.height,
        },
        penalty,
      });
      labelRequests.push({
        id: `total:${cat.id}`,
        kind: 'total',
        owner: { categoryId: cat.id },
        text: totText,
        lines: [totText],
        font: strongFont,
        priority: PRIORITY.total + (highlights.has(cat.id) ? PRIORITY.highlightBonus : 0),
        candidates: [
          slotAt(rowCy, 'outsideEnd', 0),
          slotAt(rowCy - totSize.height - 2, 'outsideEndUp', 1),
          slotAt(rowCy + totSize.height + 2, 'outsideEndDown', 2),
        ],
      });
    }

    // ---- stage (category) label in the reserved LEFT band ----
    // Every row carries its name. The box is fitted to the lane height and
    // then pushed inside the lane, because a box that merely touches the
    // neighbouring lane is refused as that row's territory and the stage
    // would go unnamed.
    if (labelOn('category')) {
      const lanes = Math.max(1, Math.floor(lane.h / lineHeight(catFont(cat))));
      const info = lanes >= catInfo[ci]!.lines.length ? catInfo[ci]! : fitCatName(cat, bandW - 14, lanes);
      labelRequests.push({
        id: `category:${cat.id}`,
        kind: 'category',
        owner: { categoryId: cat.id },
        text: catLabelOf(cat),
        lines: info.lines,
        ...(info.title ? { title: info.title } : {}),
        font: catFont(cat),
        priority: PRIORITY.grandTotal,
        candidates: [
          {
            slot: 'left',
            // names stand left-aligned at the plot edge.
            rect: { x: inner.x, y: laneY(lane, rowCy, info.h), w: info.w, h: info.h },
            penalty: 0,
          },
        ],
      });
    }

    if (chipMode) pushChips(cat, ci, rowChips, segRecs.length);
    else pushSegmentValues({
      cat,
      segLabs,
      drawn: segRecs.length,
      ry,
      bw,
      rowCy,
      rowEndX,
      lane,
      totalWidth: totSize.width,
    });
  });

  // ---- DERIVED conversion capsules between consecutive rows ----
  let worstCaptionRect: Rect | undefined;
  const captionRects: Rect[] = [];
  if (labelOn('point')) {
    steps.forEach((conv) => {
      const ci = stages.findIndex((c) => c.id === conv.fromId);
      if (ci < 0 || ci + 1 >= stages.length) return;
      // A caption in the right-hand column stands level with the gap between the bars.
      const gapTop = band.position(ci) + band.bandwidth + (inGap ? underH(ci) : 0);
      const gapBot = band.position(ci + 1);
      const gapCy = (gapTop + gapBot) / 2;
      // Fitted up front to the width right of the baseline: it wraps before it
      // truncates, and only cuts a stage name when no width is left.
      const caption = captions.get(conv.fromId)!;
      const text = caption.lines.join(' ');
      const t = { width: caption.w, height: caption.h };
      // In the gap, from the baseline; status segments never influence
      // conversion arithmetic or placement.
      const centred = { x: inGap ? x0 : convRight - t.width, y: gapCy - t.height / 2, w: t.width, h: t.height };
      // The callout under the caption: the pair moves up as one block.
      const stacked = caption === worstCaption && calloutStackH > 0
        ? { ...centred, y: gapCy - (t.height + calloutStackH) / 2 }
        : undefined;
      if (caption === worstCaption) worstCaptionRect = stacked ?? centred;
      captionRects.push(stacked ?? centred);
      labelRequests.push({
        id: `conv:${conv.fromId}:${conv.toId}`,
        claimId: `funnel:conv:${conv.fromId}:${conv.toId}`,
        kind: 'point',
        role: composedTextRole(text),
        owner: { categoryId: conv.fromId },
        text,
        lines: caption.lines,
        ...(caption.title ? { title: caption.title } : {}),
        font: highlightedStep(conv.fromId) ? captionStrong : captionFont,
        typeRole: 'footnote',
        priority:
          PRIORITY.extreme + (highlights.has(conv.fromId) ? PRIORITY.highlightBonus : 0),
        candidates: [
          ...(stacked ? [{ slot: 'conversionColumnStacked', rect: stacked, penalty: 0 }] : []),
          { slot: 'conversionColumn', rect: centred, penalty: 0 },
        ],
      });
    });
  }

  // The automatic drop-off callout is a source-row-owned label in the same
  // solve batch as totals, segment values and captions, so its geometry stays
  // honest without annotation-specific exceptions in the shared solver. Its
  // home is the reserved right column, level with its own row; without a
  // column it goes under the bar. No leader: the column already reads as one
  // row, and a rule through the value column reads as a minus sign.
  if (callout && worstDrop) {
    const ci = stages.findIndex((c) => c.id === worstDrop!.fromId);
    const lane = rowLanes[ci]!;
    const rowCy = band.position(ci) + band.bandwidth / 2;
    const shown = callout.column ?? callout.below;
    const candidates: SlotCandidate[] = [];
    if (callout.column) {
      const column = callout.column;
      const far = Math.max(inner.x + 2, innerRight - column.w - 2);
      // By its own bar, past the row's printed values; the far edge of the
      // reserved column only when that place is taken.
      // It never takes a step caption's place: the near slot is offered only clear of them.
      const near = clamp(rowValueEnd.get(worstDrop.fromId)! + CALLOUT_GUTTER, inner.x + 2, far);
      const rect = (x: number) => ({ x, y: laneY(lane, rowCy, column.h), w: column.w, h: column.h });
      const nearClear = far - near > 1 && !captionRects.some((r) => rectsOverlap(r, rect(near), 2));
      if (nearClear) candidates.push({ slot: 'sourceOuter', rect: rect(near), penalty: 0 });
      candidates.push({ slot: nearClear ? 'sourceOuterFar' : 'sourceOuter', rect: rect(far), penalty: nearClear ? 1 : 0 });
    } else {
      candidates.push(...belowCalloutCandidates(callout.below, worstCaptionRect, {
        x: clamp(rowEnds[ci]! + 8, x0 + 4, Math.max(x0 + 4, innerRight - callout.below.w - 2)),
        y: Math.max(lane.y, lane.y + lane.h - callout.below.h - 3),
      }, lineHeight(captionFont)));
    }
    labelRequests.push({
      id: 'annotation:note-worst-drop',
      kind: 'annotation',
      owner: { categoryId: worstDrop.fromId, annotationId: 'note-worst-drop' },
      text: shown.lines.join(' '),
      lines: shown.lines,
      ...(shown.title ? { title: shown.title } : {}),
      font: labelFont,
      priority: PRIORITY.extreme,
      candidates,
    });
  }

  // Pins bypass collision checks in the shared solver. Remove every
  // row-owned candidate that leaves its declared lane before the solver sees
  // it, so even a forced slot cannot trespass into another row.
  for (const request of labelRequests) {
    const categoryId = request.owner.categoryId;
    if (categoryId === undefined) continue;
    const ci = stages.findIndex((stage) => stage.id === categoryId);
    if (ci < 0) continue;
    request.candidates = request.candidates.filter((candidate) =>
      rectContains(rowLanes[ci]!, candidate.rect),
    );
  }

  // Full-width row lanes are synthetic marks: the solver treats a lane as
  // available to its own category and foreign-occupied to every other row.
  // The CLAIM is inset by LANE_PAD while the lane itself stays whole: lanes
  // tile without a gap, so a claim on the full rect would put a two-pixel moat
  // at every row boundary and refuse any label that fills its own row.
  // Containment is still judged against the whole lane below.
  stages.forEach((stage, ci) => {
    const lane = rowLanes[ci]!;
    occupied.claim(
      { x: lane.x, y: lane.y + LANE_PAD, w: lane.w, h: Math.max(1, lane.h - 2 * LANE_PAD) },
      'mark',
      { categoryId: stage.id },
      'funnel-row-lane',
    );
  });

  // ---- solve labels ----
  const solveCtx: SolveCtx = labelCtx(theme, size, options, {
    measure,
    plot,
    labelPad: LABEL_PAD,
  });
  const solved = solveLabels(labelRequests, occupied, solveCtx);
  pushAll(warnings, solved.warnings);
  for (const label of solved.placed) {
    if (label.hidden !== 'collision' || label.owner.categoryId === undefined) continue;
    warnings.push({
      code: 'funnel-label-hidden',
      severity: 'warn',
      message: `label '${label.id}' could not stay in row '${label.owner.categoryId}' without a collision — hidden`,
      owner: label.owner,
    });
  }

  // ---- caller-authored annotations ----
  const resolve = (ref: AnchorRef): AnchorResolution | null => {
    const norm = typeof ref === 'string' ? { categoryId: ref, edge: 'total' as const } : ref;
    if (!('categoryId' in norm) || !norm.categoryId) return null;
    const ci = stages.findIndex((c) => c.id === norm.categoryId);
    if (ci < 0) return null;
    const cat = stages[ci]!;
    const rowCy = band.position(ci) + band.bandwidth / 2;
    let value = stageTotals[cat.id] ?? null;
    let xEnd = xScale(known[ci]!);
    if ('seriesId' in norm && norm.seriesId) {
      const si = plotted.findIndex((s) => s.id === norm.seriesId);
      if (si < 0) return null;
      value = values[si]![ci] ?? null;
      xEnd = cumEnd[ci]![si]!;
    }
    if (value === null) return null;
    const edge = norm.edge ?? 'total';
    // A delta or abs on a stage total hangs under the bar end: level with the
    // row, its only free slot was right of the bold total, and a leader there
    // reads as a minus sign. Comparisons keep the row's centre line.
    const underBar = totalAnchorStage(ref) === ci;
    return {
      x: edge === 'start' ? x0 : xEnd,
      y: underBar ? band.position(ci) + band.bandwidth : rowCy,
      ...(underBar ? { comparisonPoint: { x: xEnd, y: rowCy } } : {}),
      // A callout leads onto its own bar, inside the bar end, so it cannot
      // read as pointing at the row above.
      calloutPoint: {
        x: edge === 'start' ? x0 : Math.max(x0 + 1, xEnd - Math.min(CALLOUT_INSET, (xEnd - x0) / 2)),
        y: band.position(ci) + Math.min(CALLOUT_INSET, band.bandwidth / 4),
      },
      value,
      date: cat.date, label: cat.label,
      owner: { categoryId: cat.id, ...(norm.seriesId ? { seriesId: norm.seriesId } : {}) },
    };
  };

  const userAnnotations: Annotation[] = options.annotations ?? [];
  // Authored annotations retain their generic annotation ownership. Give
  // their pass the fully solved funnel geometry but omit the synthetic row
  // lanes, which are meaningful only to row-owned funnel labels.
  const annotationOccupied = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const annotationSeed = occupied
    .snapshot()
    .filter((claim) => claim.part !== 'funnel-row-lane');
  for (const claim of annotationSeed) {
    annotationOccupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
  }
  // A delta or abs on a stage total belongs under its bar end. The row's
  // value column right of the bar is kept from it, where it could only hang
  // on a stub leader that reads as a minus sign.
  for (const ann of userAnnotations) {
    const ci = ann.kind === 'delta' || ann.kind === 'abs' ? totalAnchorStage(ann.at) : -1;
    if (ci < 0) continue;
    const endX = xScale(known[ci]!);
    annotationOccupied.claim({ x: endX, y: band.position(ci), w: innerRight - endX, h: band.bandwidth },
      'mark', { categoryId: stages[ci]!.id }, 'funnel-value-column');
  }
  const annResult = runAnnotatePass({
    annotations: userAnnotations,
    valueAxis: 'horizontal',
    defaultSpan: stages.length > 1 ? { from: stages[0]!.id, to: stages.at(-1)!.id } : undefined,
    calloutLeaderWidths: 3,
    comparisonLayout: funnelComparisonLayout(arrowBandH > 0 ? rowsBottom + annotationBandH - 5 : undefined),
    resolve,
    occupied: annotationOccupied,
    plot: { ...plot, h: plot.h + annotationBandH },
    theme,
    measure,
    format: options.format,
    locale: options.locale?.language,
    strings: options.strings,
    solveCtx,
  });
  pushAll(warnings, annResult.warnings);
  const annotationClaims = annotationOccupied.snapshot().slice(annotationSeed.length)
    .filter((claim) => claim.part !== 'funnel-value-column');
  for (const claim of annotationClaims) {
    occupied.claim(claim.rect, claim.kind, claim.owner, claim.part);
  }
  const autoNoteAnnotations: PlacedAnnotation[] = callout && worstDrop
    ? [{
        id: 'note-worst-drop',
        kind: 'note',
        computedText: (callout.column ?? callout.below).lines.join(' '),
        nodeIds: [],
        labelId: 'annotation:note-worst-drop',
      }]
    : [];

  // ---- emit ----
  const allLabels: PlacedLabel[] = [...solved.placed, ...annResult.labels];
  // The highlighted stage's outgoing caption keeps the ink colour.
  for (const label of allLabels) {
    if (label.id.startsWith('conv:') && !highlightedStep(label.owner.categoryId ?? '')) label.ink = { token: 'inkMuted' };
  }
  pushAll(nodes, annResult.nodes);
  pushAll(nodes, labelsToNodes(theme, allLabels, (l) =>
      l.kind === 'total'
        ? strongFont
        : l.id.startsWith('conv:')
          ? highlightedStep(l.owner.categoryId ?? '') ? captionStrong : captionFont
          : l.kind === 'category'
            ? highlights.has(l.owner.categoryId ?? '') ? tickStrong : tickFont
            : chipMode && l.kind === 'segment' && highlights.has(l.owner.categoryId ?? '') ? strongFont : labelFont, nodes,
    ));

  const first = stages[0]!;
  const last = stages[stages.length - 1]!;
  const a11yParts = stages.map((c, ci) => {
    const total = shownTotals[c.id] ?? null;
    let p = `${c.label} ${total === null ? chartString(options, 'missing') : totalFmt(total)}`;
    const conv = conversions.find((cv) => cv.fromId === c.id);
    if (conv) {
      const to = stages[ci + 1]!;
      p += conv.rate > 1
        ? chartString(options, 'funnelIncreaseDesc', { v1: c.label, v2: to.label })
        : chartString(options, 'funnelConversionDesc', { v1: c.label, v2: to.label, v3: fmtPct(conv.rate) });
    }
    return p;
  });

  const labelH = Math.max(maxOf(catInfo.map((label) => label.h)), maxOf(totalSizes.map((label) => label.height)));
  // Chip rows: a thin bar, its chip line and a caption gap per step, and the
  // last row only its bar and chips.
  const chipLastH = (barH: number): number => Math.max(barH + (totalAnnotationGap > 0 ? totalAnnotationGap / 2 + 2 * LANE_PAD : 0), labelH + 2 * LANE_PAD) + (chipsOnRow(stages.length - 1) ? chipUnderH : 0);
  const chipCap = inner.w < CARD_PLOT_W ? CHIP_BAR_CARD : CHIP_BAR;
  const chipCaptionGap = (pad: number): number => (captions.size > 0 ? maxOf(shownCaptions.map((c) => c.h)) + 2 * pad : 2 * pad);
  const naturalRowsH = (stages.length - 1) * Math.max(chipCap + chipUnderH + chipCaptionGap(CHIP_CAPTION_PAD), labelH + 2 * LABEL_PAD) + chipLastH(chipCap);
  // At the minimum the step captions move to their right-hand column.
  const chipMinBar = Math.min(chipCap, Math.max(10, labelH));
  const chipMinimumRowsH = (stages.length - 1) * Math.max(chipMinBar + chipUnderH + LABEL_PAD, labelH + 2 * LABEL_PAD) + chipLastH(chipMinBar);
  const paintWarningRules: PaintWarningRule[] = [];
  pushAll(warnings, rectSeriesAdjacentWarnings(nodes, (paint) => paintColor(theme, paint), 'horizontal', highlights, theme, { rules: paintWarningRules, before: warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss'].includes(warning.code)).length }));
  return {
    type: 'funnel',
    size,
    sizing: rowSizing('funnel', size, {
      chromeH: size.height - rowsSpace,
      minimumRowsH: chipMinimumRowsH,
      naturalRowsH,
      // The frame around the rows, the stage-name column, the longest bar
      // at its shortest readable length, and the stage totals after it.
      minWidth: size.width - inner.w + bandW + MIN_LONGEST_BAR + totalReserve,
    }),
    plot,
    scene: withSegmentSeams(nodes, theme),
    labels: allLabels,
    axes: [
      {
        axis: 'y',
        ticks: stages.map((c, ci) => ({
          at: c.id,
          pos: band.position(ci) + band.bandwidth / 2,
          labelId: labelOn('category') ? `category:${c.id}` : undefined,
        })),
      },
    ],
    annotations: [...annResult.placed, ...autoNoteAnnotations],
    legend: frameResult.legend,
    frame: frameResult.frame,
    marks,
    derived: { stageTotals, conversions, ...(worstDrop ? { worstDrop } : {}) },
    a11y: {
      title: accessibleTitle(options.title, chartString(options, 'funnelTitle', { v1: first.label, v2: last.label })),
      counts: [structureCount('stages', stages.length, chartString(options, 'stagesCount', { v1: stages.length, v2: stages.length === 1 ? '' : 's' }))],
      desc: chartString(options, 'funnelDesc', { v1: stages.length, v2: stages.length === 1 ? '' : 's', v3: a11yParts.join('; ') }),
    },
    warnings,
    paintWarningRules,
    debug: {
      occupied: occupied.snapshot(),
      decisions: [...solved.decisions, ...annResult.decisions],
    },
  };

  // ---- helpers ----

  /** Fixed chip columns: one per series, as wide as the widest chip of the chart. */
  function chipColumns(): { colW: number; pitch: number; blockW: number; lineH: number } {
    let textW = 0;
    stages.forEach((c, ci) => plotted.forEach((_s, si) => {
      const v = values[si]![ci];
      if (v == null || v <= 0) return;
      const text = cellText(si, ci, v);
      if (text) textW = Math.max(textW, measure(text, highlights.has(c.id) ? strongFont : labelFont).width);
    }));
    const colW = textW + SWATCH_RESERVE;
    const pitch = colW + CHIP_GAP;
    return { colW, pitch, blockW: plotted.length * pitch - CHIP_GAP, lineH: lineHeight(labelFont) };
  }

  /**
   * Chip rows: each bar at the top of its step, a thin bar, the
   * chip line under it on narrow frames, and the step caption centred in the
   * rest of the gap. The last row keeps only its bar and chips, so the space
   * goes between the rows and not under the last one.
   */
  function chipRowBand(): { position: (i: number) => number; bandwidth: number; step: number } {
    const n = stages.length;
    const cap = inner.w < CARD_PLOT_W ? CHIP_BAR_CARD : CHIP_BAR;
    const rowLabelH = Math.max(maxOf(catInfo.map((c) => c.h)), maxOf(totalSizes.map((t) => t.height)));
    const lastExtra = chipsOnRow(n - 1) ? chipUnderH : 0;
    const minGap = captions.size > 0 ? captionOnlyBandH + 2 * LABEL_PAD : 4;
    // The last row keeps the height of a wrapped name, so the name never cuts.
    // A delta or abs on a stage total hangs under the bar end, inside its row.
    const lastFloor = Math.max(rowLabelH + 2 * LANE_PAD,
      totalAnnotationGap > 0 ? Math.min(cap, rowsH / n) + totalAnnotationGap / 2 + 2 * LANE_PAD : 0);
    const fitBw = n > 1 ? (rowsH - lastExtra - lastFloor - (n - 1) * (chipUnderH + minGap)) / (n - 1) : rowsH - lastExtra;
    // A bar never gets thinner than its name and total, so they never hang
    // into the chip line under it.
    // An authored bandFraction sets the bar's share of the row step instead
    // of the thin default, as far as the chips and captions leave room.
    const want = options.bandFraction !== undefined ? options.bandFraction * (rowsH / n) : cap;
    const floor = Math.min(want, Math.max(10, rowLabelH));
    const bandwidth = Math.max(floor, Math.min(want, fitBw));
    const lastH = Math.max(bandwidth, lastFloor) + lastExtra;
    const step = n > 1 ? Math.max(bandwidth, (rowsH - lastH) / (n - 1)) : rowsH;
    return { position: (i) => rowsTop + i * step, bandwidth, step };
  }

  /** The stage whose total an anchor names, or -1. */
  function totalAnchorStage(ref: AnchorRef): number {
    const norm = typeof ref === 'string' ? { categoryId: ref } : ref;
    if (!('categoryId' in norm) || norm.seriesId || (norm.edge ?? 'total') !== 'total') return -1;
    return stages.findIndex((stage) => stage.id === norm.categoryId);
  }

  /** A stage's paint when `ci` is given; the key's paint without it. */
  function seriesPaint(s: Series, si: number, ci?: number): Paint {
    const ramp = rampFunnelPaint(theme, plotted, s, ci ?? 0, paletteRamp ? options.palette : undefined, stages.length);
    if (ramp) return ramp;
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole, true);
    const paint = themeSeriesPaint(si, paletteRamp ? options.palette : undefined);
    // A single series whose ramp has fewer steps than stages shades its one
    // paint by stage, as the centred layout does, so no two stages share a fill.
    return ci !== undefined && theme.marks?.funnelFill === 'ramp' && plotted.length === 1 && stages.length > 1
      ? shadeStage(paint, ci, stages.length, undefined) : paint;
  }

  function seriesCss(s: Series, si: number, ci: number): string {
    return paintColor(theme, seriesPaint(s, si, ci));
  }
}

function seriesPattern(s: Series): 'hatch45' | 'outline' | undefined {
  // Accept scenario aliases (ACT/BUD/FCST) here too
  const sc = normalizeScenario(s.scenario, `series[${s.id}].scenario`);
  return sc === 'FC' ? 'hatch45' : sc === 'PL' ? 'outline' : undefined;
}
