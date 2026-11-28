import { bandedCategoryStyle, categoryHeightLimit, withCategoryTitle } from '../../label/categoryRow';
import { hiddenKey } from '../../hiddenSeries';
import { chartString } from '../../strings/column';
import { stringFields } from '../../strings';
import { DEFAULT_TARGET } from '../../target';
/**
 * Column phase 1, frame and scale: the legend, the margins and the frame,
 * then the reserves around the plot, the band, the category row and the
 * value scale.
 */

import { BAND_PAD, VALUE_LINE_RESERVE } from '../../annotateParts';
import { axisTitleAllowed, measureValueAxisWidth, planCategoryTitle, planValueAxisTitle, valueAxisTitleBand, valueAxisTitleText, valueAxisUnit } from '../../axis';
import { bandedCrossesBetween } from '../../intervalTicks';
import { authoredDateTicks, longDayMonths, type dateTickRow } from '../../calendarLabels';
import { formatAutomaticPercent, notApplicableGlyph } from '../../format';
import { percentCellsOnly } from '../../annotatePass';
import {
  frameTextOptions,
  fixedPlotChrome,
  plotChromeFloor,
  recordFreedChrome,
  normalizeLegendOption,
  plotHeightAfter,
  solveFrame,
  type FrameWidthMeasurements,
  type FrameBand,
  type FrameInput,
  type FrameResult,
  type LegendItemInput,
  authoredFootnoteCount, authoredNotes, caveatNoteLine, shareUnitOptions } from '../../frame';
import { copyFrame, staticFrame } from '../../footer';
import { zeroLifts } from '../../formatPrecision';
import { hasCompleteTextWidths } from '../../fontMetrics/injected';
import { columnHeightSearch, measureColumnHeight, sameContent, type ColumnHeightTrial } from '../../sizing';
import type { Rect } from '../../geometry';
import { categoryRowTop, hangingLabelReserve, measuredRotatedNames, openingRotatedNames, planCategoryRow, yieldToRotatedName } from '../../label/categoryRow';
import { fitText } from '../../label/fitText';
import { createOccupiedIndex, type OccupiedClaim, type OccupiedIndex } from '../../label/occupied';
import { scenarioLegendKeys } from '../../label/legendFidelity';
import { hasEarlierPartialHatch, partialAxisWords, partialFootnotes, partialLegendKeys, RUNNING_PERIOD_LEGEND_ID } from '../../partialPeriod';
import { prepareRatioTier, ratioTierCanRender, ratioTierMetrics } from '../../ratioTier';
import { bandScale, brokenLinearScale, linearScale, seatRoom } from '../../scale';
import { defaultMeasurer, type FontSpec } from '../../text';
import { canvasMargin, panelTypeClass, emphasisWeight, strokeToken, dashToken } from '../../theme';
import type { Annotation } from '../../types/annotations';
import { percentLevels } from '../../annotatePass';
import { toleranceLegendKeys } from '../../valueLineDomain';
import type { Id } from '../../types/cell';
import type { LegendOptions } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import { contentOf, edgeNameFont, edgeNamesReplaceKey, KEY_EDGE_SERIES, kindSetting, partialNamedOnValues, pyTickKeyed, rightEdgeSeriesLabels, RIGHT_EDGE_GAP, shareTextOf } from './domain';
import { ANOMALY_FLAG_GAP, ANOMALY_FLAG_H, TICK_LABEL_RESERVE, PY_TICK_LEAD, type ColumnArea, type ColumnDomain, type NormSer } from './model';
import { seriesPattern, signWord, type ColumnLegendPaints } from './paints';
import { signPaint } from '../band/sign';
import { anomalyLegendItems, anomalyRuleLines, anomalyRuleReserve } from './anomaly';
import { segmentHatchGround } from './marks';
import { referenceMarkerKey } from '../band/ticks';
import { netLineName } from '../band/stacks';
import { disclosuresShown } from '../../notes';
import { categoryLabelsAndMarks } from '../../footnoteMark';
import { staircaseDirection, staircaseOn, staircaseRoom, staircaseState } from '../../label/staircase';
import { textScaleOf } from '../../typeFloors';
import { compactValueLabelFont } from '../band/labels';
import { groupedOffsets } from '../band/groups';
import { NARROW_SHARE_WIDTH, PLOT_FLOOR_PX, PLOT_FLOOR_SHARE, plotFloorRows, plotFloorShare } from '../../sizing';
import { stackTotalText } from './labels';
import { maxOf, minOf, pushAll } from '../../arrays';
import { categoryInsetOf, insetRange } from '../../grid/categoryInset';

/** Internal layout marker (histogram): the bands tile the plot with no outer padding. Authored JSON cannot set it. */
export const TILED_BANDS = Symbol('tiledBands');

/**
 * Internal option: the segment values a first pass could not print on their
 * columns, which the note line names. Set by
 * `layoutColumn` on its second pass; authored JSON cannot.
 */
/** Internal option: the rank mapping or the cut names the category row gave to the notes. */
export const CATEGORY_NOTES = Symbol('categoryNotes');
/**
 * Px the CAGR arm row takes over its 30 px, set by a second pass when the
 * arm could not rise high enough to give its arrow end its minimum shaft
 * (the arm reports the shortfall as its leg deficit).
 */
export const CAGR_PAD = Symbol('cagrPad');

/** The paint and pattern every drawn column of a series shares, or nothing when they differ. */
function uniformCellLook(domain: ColumnDomain, paints: ColumnLegendPaints, s: NormSer, i: number): Pick<LegendItemInput, 'paint' | 'pattern'> | object {
  let first: { paint: Paint; pattern: ReturnType<typeof paints.pattern> } | undefined;
  for (const [ci, c] of domain.cats.entries()) {
    const v = domain.plottedOf(s, ci);
    if (v === null || (domain.variant !== 'grouped' && v === 0)) continue;
    const val = s.vals[ci]!;
    const paint = paints.cell(s, val, c, i);
    const pattern = paints.pattern(s, val, c);
    if (!first) first = { paint, pattern };
    else if (pattern !== first.pattern || (paint !== first.paint && paints.css(paint) !== paints.css(first.paint))) return {};
  }
  if (!first) return {};
  const hatchGround = segmentHatchGround(domain.variant === 'grouped' ? 'bar' : 'segment', first.pattern, first.paint);
  return { paint: first.paint, pattern: first.pattern, ...(hatchGround ? { hatchGround } : {}) };
}

/**
 * The legend items: the series (two sign keys each under signColor), the
 * scenario and partial-period keys, the references and the anomaly marks.
 */
function columnLegendItems(domain: ColumnDomain, paints: ColumnLegendPaints): LegendItemInput[] {
  const { dataSeries, refSeries, variant, refStyle, anomaly, corridorShown, statFmt } = domain;
  const legendUsesSeriesIdentity = domain.uniformScenario.size > 0;
  // A series whose name the edge cannot be trusted to print keeps its CAGR in the key.
  const edgePrinted = new Set((domain.options as { [KEY_EDGE_SERIES]?: true })[KEY_EDGE_SERIES] ? [] : rightEdgeSeriesLabels(domain).map((series) => series.id));
  // A sign-coloured series has no single swatch: one key in the series'
  // identity colour would be a legend that lies about the encoding it is
  // explaining. It gets the two keys it actually
  // paints instead, in the tones the columns actually carry.
  const seriesItems: LegendItemInput[] = domain.signColor
    ? dataSeries.flatMap((s) => [
        {
          id: `${s.id}:above`,
          label: stringFields(domain.options.strings!.aboveZero!, { series: s.label, meaning: signWord(s, true, domain.options.strings) }),
          paint: signPaint(s, 1, domain.options.colorblindSafe),
        },
        {
          id: `${s.id}:below`,
          label: stringFields(domain.options.strings!.belowZero!, { series: s.label, meaning: signWord(s, false, domain.options.strings) }),
          paint: signPaint(s, -1, domain.options.colorblindSafe),
        },
      ].filter((_, index) => s.vals.some(v => v.v !== null && (index === 0 ? v.v > 0 : v.v < 0))))
    : domain.keySeries.map((s, place) => {
        const i = s.lastVisibleIndex ?? place;
        const label = edgePrinted.has(s.id) ? s.label : domain.seriesCagr.get(s.id)?.text ?? s.label;
        // A series a reader hid keeps its entry, as a hollow box.
        return dataSeries[i] !== s ? hiddenKey(s.id, label, place) : {
          id: s.id,
          label,
          paint: legendUsesSeriesIdentity ? paints.identity(s) : paints.base(s, i),
          pattern: legendUsesSeriesIdentity ? undefined : seriesPattern(s),
          // A series whose every drawn column looks the same is keyed in that look, hatch included.
          ...uniformCellLook(domain, paints, s, i),
        };
      });
  // Series the edge names do not repeat in the key.
  const edgeNamed = edgeNamesReplaceKey(domain) ? new Set(rightEdgeSeriesLabels(domain).map((series) => series.id)) : undefined;
  const keyedSeries = edgeNamed ? seriesItems.filter((item) => !edgeNamed.has(item.id)) : seriesItems;
  return [
    ...keyedSeries,
    // The scenario the CELLS carry, when no series key already carries it.
    // `keyPatterns` reads the items just built rather than re-deriving them,
    // so the two can never disagree about what the legend already says.
    // suppressed refs (stacked100) must not appear in the legend either —
    // a swatch for an unrendered mark is a lying legend
    ...(variant === 'stacked100'
      ? []
      : refSeries.map((s) => ({
          id: s.id,
          label: referenceKeyLabel(domain, s),
          paint: refStyle === 'marker' ? paints.ref(s) : paints.refStroke(s),
          key: 'line' as const,
          ...(refStyle === 'line' ? { dash: dashToken(domain.theme, 'dotted'), lineCap: 'round' as const, width: strokeToken(domain.theme, 'rule') } : { width: strokeToken(domain.theme, 'rule') }),
          ...(refStyle === 'marker' ? referenceMarkerKey(domain.theme, paints.ref(s)) : {}),
        }))),
    ...scenarioLegendKeys({
      markPatterns: paints.cellPatterns,
      keyPatterns: keyedSeries.map((item) => item.pattern),
      paint: { token: 'neutralMark' }, strings: domain.options.strings,
    }),
    ...partialLegendKeys(paints.partialHatch, domain.options.strings, domain.running, partialNamedOnValues(domain), domain.cats),
    // The flag marker and the corridor rule carry the anomaly verdict, so the
    // legend keys them, not only the fill. Key glyphs mirror the actual mark
    // encoding, so these are drawn as a marker and a dashed line, in the same
    // paint the furniture uses.
    ...anomalyLegendItems(domain.theme, anomaly, corridorShown, statFmt, paints.corridor, domain.options.strings, domain.options.locale?.language),
    // An interval whisker is keyed in its shape.
    ...(rangeDrawn(domain) ? [{ id: '__range', label: domain.options.strings!.range!, paint: { token: 'ink' } as const, key: 'whisker' as const, width: strokeToken(domain.theme, 'rule') }] : []),
  ];
}

/** A grouped grid panel's share of its band, and its widest bar. */
const PANEL_GROUP_FRACTION = 0.72;
const PANEL_GROUP_BAR = 76;

/** The share of its category pitch a column had before the narrower default. */
export const COLUMN_FRACTION_MAX = 0.7;
/** The most of its category pitch a column group takes so that every series prints its values. */
const GROUPED_FRACTION_MAX = 0.92;

/**
 * The default share of its category pitch for one column per category: half on
 * a wide plot, a little more on a narrow one (0.50 at a 218 px pitch or wider,
 * 0.56 at 64 px or narrower, linear between).
 */
function columnBandFraction(plotW: number, count: number): number {
  const pitch = plotW / Math.max(1, count);
  return 0.56 - 0.06 * Math.min(1, Math.max(0, (pitch - 64) / (218 - 64)));
}

/**
 * A prior-year reference named only by its code ("PY") is keyed with the
 * `priorYearKey` string, the code alone like the FC and PL keys. Any other
 * authored name is kept as written.
 */
function referenceKeyLabel(domain: ColumnDomain, s: NormSer): string {
  return s.scenario === 'PY' && s.label.trim() === 'PY' ? chartString(domain.options, 'priorYearKey') : s.label;
}

/** Whether any column carries an interval whisker (a grid panel leaves the key to its grid). */
function rangeDrawn(domain: ColumnDomain): boolean {
  return panelTypeClass(domain.options) === undefined &&
    domain.dataSeries.some((s) => domain.cats.some((_, ci) => domain.rangeOf(s, ci) !== undefined));
}

/** The annotations the annotation pass gets. Events belong to the event lane. */
export function columnPassAnnotations(domain: Pick<ColumnDomain, 'annList'>): Annotation[] {
  return domain.annList.filter((annotation) => annotation.kind !== 'event');
}

/** The number format and the words of the annotation pass. A tolerance band's key prints its bounds in them. */
export function columnPassText(domain: Pick<ColumnDomain, 'options' | 'valueSpec' | 'dataSeries'>) {
  return {
    format: domain.options.format,
    locale: domain.options.locale?.language,
    levelSpec: percentLevels(domain.dataSeries) ? { ...domain.valueSpec.percentSpec, suffix: '' } : domain.valueSpec.spec,
    strings: domain.options.strings,
  };
}

/**
 * The legend input (the legend is a layout participant).
 *
 * signColor and the anomaly furniture are ENCODINGS, not decoration: red vs
 * green by sign (inverted under lowerIsBetter) and an olive flag/corridor
 * that carries the verdict. An opt-in legend meant every shipped exhibit
 * rendered those encodings with nothing naming them — the reader decodes by
 * guessing. They now bring their own legend.
 *
 * `legend: 'none'` still suppresses it — an explicit instruction is honoured —
 * but that suppression is disclosed rather than silent.
 */
function columnLegend(
  domain: ColumnDomain,
  paints: ColumnLegendPaints,
  warnings: LintWarning[],
): FrameInput['legend'] {
  const { options, signColor, anomaly } = domain;
  // A drawn reference (a plan tick, a PY dot) is an encoding too, so it brings its key.
  // A grid panel leaves its key to the grid legend, which collects it.
  const referenceDrawn = domain.variant !== 'stacked100' && panelTypeClass(options) === undefined &&
    domain.refSeries.some((s) => s.vals.some((val) => val.v !== null));
  // A tolerance band says nothing about itself: the key names it and prints its bounds. A grid panel keeps the bounds in the band.
  const toleranceKeys = panelTypeClass(options) === undefined
    ? toleranceLegendKeys(columnPassAnnotations(domain), domain.meanValue, domain.cats.map((c) => c.id), columnPassText(domain)) : [];
  const legendForcedByEncoding = signColor || anomaly !== undefined || referenceDrawn || rangeDrawn(domain);
  if (legendForcedByEncoding && options.legend === 'none') {
    warnings.push({
      code: 'legend-suppressed-encoding',
      severity: 'warn',
      message:
        "legend: 'none' suppressed the only key naming this exhibit's encodings" +
        ` (${[signColor ? 'sign colour' : '', anomaly ? 'the anomaly corridor and flag marker' : '', referenceDrawn ? 'the reference mark' : ''].filter(Boolean).join(', ')}) — the reader is left to infer them`,
      suggest: "drop legend: 'none', or drop signColor/anomaly/the reference series",
    });
  }
  const effectiveLegend =
    options.legend === undefined && (legendForcedByEncoding || toleranceKeys.length > 0) ? 'top' : options.legend;
  if (!effectiveLegend || effectiveLegend === 'none' || effectiveLegend === 'auto') return undefined;
  const legendOpts: LegendOptions = normalizeLegendOption(effectiveLegend);
  // A key row that only the band brought does not repeat the name of the one series.
  const single = options.legend === undefined && !legendForcedByEncoding && domain.keySeries.length === 1 ? domain.keySeries[0]!.id : undefined;
  let items = [...columnLegendItems(domain, paints).filter((item) => item.id !== single), ...toleranceKeys];
  // Edge names that explain every series leave no key to draw.
  if (items.length === 0 && edgeNamesReplaceKey(domain)) return undefined;
  if (legendOpts.order) {
    const oi = (id: Id) => {
      const k = legendOpts.order!.indexOf(id);
      return k === -1 ? Number.MAX_SAFE_INTEGER : k;
    };
    items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
  }
  return { options: legendOpts, items };
}

/**
 * An event band or an earlier partial hatch can bring a key row of its own.
 * It names the patterns in the plot without repeating a single series name.
 */
function bandKeyRow(domain: ColumnDomain, paints: ColumnLegendPaints, eventKey: FrameBand | undefined): FrameInput['legend'] {
  const { options } = domain;
  const earlierHatch = options.legend !== 'none' && panelTypeClass(options) === undefined
    && hasEarlierPartialHatch(paints.partialHatch, domain.running);
  if (!eventKey?.legend?.length && !earlierHatch) return undefined;
  const single = domain.keySeries.length === 1 ? domain.keySeries[0]!.id : undefined;
  const items = columnLegendItems(domain, paints).filter((item) => item.id !== single);
  return { options: { position: 'top' }, items };
}

/** The margins and legend use the chart data, axis and typography at this width. */
function columnFrameFurniture(domain: ColumnDomain, paints: ColumnLegendPaints, warnings: LintWarning[], eventKey?: FrameBand) {
  const { options, theme, size, measure, anomaly, corridorShown, statFmt, netLineOn, netLineSeries, variant } = domain;
  const decorationFont = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  // Every anomaly rule the engine draws carries its value in the right margin.
  // The width is reserved HERE, before the frame is solved, so the label fits
  // by construction instead of being drawn wherever it lands.
  const anomalyRuleLabelWidth = anomaly?.usable
    ? anomalyRuleReserve(anomalyRuleLines(theme, anomaly, corridorShown, { statFmt, corridorFmt: domain.corridorFmt }, { token: 'warn' }, options.strings), { family: theme.type.family, ...theme.type.label }, measure)
    : 0;
  const decorationRight = Math.max(
    netLineOn ? measure(netLineName(domain.dataSeries, netLineSeries, domain.stacks, options.strings), decorationFont).width + 12 : 0,
    anomalyRuleLabelWidth,
  );
  // The token margin is the base; the stacked100 indicator gutter and
  // the decoration reserve may only WIDEN the right side, and the ratio
  // tier keeps its own 3px bottom (the tier band replaces the bottom margin).
  const tokenMargin = canvasMargin(theme, size.width);
  // Right-edge series names take their own room from the band (columnBand), so a
  // stacked100 chart that prints them keeps the token margin, not its 56 px gutter too.
  const edgeNamesRight = options.seriesLabels?.at !== 'left-edge' && rightEdgeSeriesLabels(domain).length > 0;
  const margin = {
    ...tokenMargin,
    right: Math.max(variant === 'stacked100' && !edgeNamesRight ? 56 : tokenMargin.right, decorationRight),
    bottom: ratioTierCanRender(options.ratioTier, domain.cats, domain.seriesNorm) ? 3 : tokenMargin.bottom,
    ...options.margin,
  };
  // Preserve authored margins and decoration seats; narrow empty gutters first.
  const axisFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const axisReserve = domain.va.show ? measureValueAxisWidth([domain.dLo, domain.dHi], domain.fmt, theme, measure, 5, domain.valueSpec.spec) : 0;
  const categoryWidth = Math.max(0, maxOf(domain.cats.map(c => measure(c.label ?? c.id, axisFont).width))) + 4;
  const narrowGutters = domain.cats.length > 0 && categoryWidth > (size.width - margin.left - margin.right - axisReserve) / domain.cats.length;
  if (narrowGutters) {
    const gutter = measure('0', axisFont).height;
    if (options.margin?.left === undefined) margin.left = Math.min(margin.left, gutter);
    if (options.margin?.right === undefined) margin.right = Math.max(decorationRight, Math.min(margin.right, gutter));
  }
  // a hidden valueLine label's margin wins over an authored one, which would hide it again.
  margin.right = Math.max(margin.right, (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ?? 0,
    (options as { [TICK_LABEL_RESERVE]?: number })[TICK_LABEL_RESERVE] ?? 0);
  const legend = columnLegend(domain, paints, warnings) ?? bandKeyRow(domain, paints, eventKey);
  return { margin, legend, narrowGutters };
}

interface ColumnHeightFrame {
  transferable?: boolean;
  stacks: ColumnDomain['stacks'];
  width: number;
  axis: boolean;
  options: ColumnDomain['options'];
  furniture: ReturnType<typeof columnFrameFurniture> & { warnings: LintWarning[] };
  rows: FrameWidthMeasurements;
}

const heightFrames = new WeakMap<object, ColumnHeightFrame[]>();

/** The frame, with the legend, the event key and the right-margin decoration reserve; claims into its own index. */
export function solveColumnFrame(
  domain: ColumnDomain,
  paints: ColumnLegendPaints,
  warnings: LintWarning[],
  eventKey?: FrameBand,
  memo?: ColumnStaircaseMemo,
): { frame: FrameResult; claims: OccupiedIndex } {
  const { options, theme, size, measure } = domain;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  // The title, key and footer do not move when the staircase changes its vertical pad.
  // Each attempt gets new occupied rectangles and a frame on which to record its height.
  const reuse = memo && !eventKey && !domain.annList.length && !domain.cats.some(c => c.partial);
  const saved = reuse && memo.frame;
  if (saved) {
    pushAll(warnings, saved.warnings);
    for (const claim of saved.claims) claims.claim(claim.rect, claim.kind, claim.owner);
    return { frame: { ...saved.frame, frame: copyFrame(saved.frame.frame) }, claims };
  }
  const before = warnings.length;
  const search = reuse && !domain.activeBreak && !options.ratioTier
    && typeof options.size === 'object' && columnHeightSearch.get(options.size);
  const privateTrial = search && typeof options.size === 'object' && measureColumnHeight.has(options.size);
  const content = search ? { ...options, size: undefined } : undefined;
  const entries = search ? heightFrames.get(search) : undefined;
  let measured = content && entries?.find(e => e.stacks === domain.stacks && e.width === size.width
    && e.axis === !!domain.va.show && sameContent(e.options, content));
  if (measured) {
    // A refused opening drew no marks. Its fixed top rows can belong to one public
    // scene; the source footer still gets fresh nodes at the selected height.
    if (privateTrial) measured.transferable = false;
    else if (measured.transferable && measured.rows.plotHeightAt && !staticFrame.live && !staticFrame.pinned) {
      entries!.splice(entries!.indexOf(measured), 1);
    } else measured = undefined;
  }
  const furniture = measured?.furniture ?? (!eventKey && memo?.furniture);
  const { margin, legend, narrowGutters } = furniture || columnFrameFurniture(domain, paints, warnings, eventKey);
  if (furniture) pushAll(warnings, furniture.warnings);
  else if (!eventKey && memo && !reuse) memo.furniture = { margin, legend, narrowGutters, warnings: warnings.slice(before) };
  if (privateTrial && search && content && !measured) {
    measured = { stacks: domain.stacks, width: size.width, axis: !!domain.va.show, options: content,
      furniture: { margin, legend, narrowGutters, warnings: warnings.slice(before) }, rows: {} };
    if (memo.growthTrial) memo.openingFrame = measured;
    if (entries) entries.push(measured); else heightFrames.set(search, [measured]);
  }
  const frame = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(shareUnitOptions('column', options)),
      footnotes: [
        ...partialFootnotes(domain.cats, options.strings, domain.running, legend?.items.some(item => item.id === RUNNING_PERIOD_LEGEND_ID) || partialNamedOnValues(domain)), ...authoredNotes(options),
        ...columnValueNotes(domain),
      ],
      legend,
      ...(eventKey ? { eventKey } : {}),
      theme,
      measure,
    },
    claims,
    measured?.rows,
  );
  if (reuse) {
    memo.plotHeightAt = measured?.rows.plotHeightAt;
    memo.narrowGutters = narrowGutters;
    memo.frame = { frame, claims: claims.snapshot(), warnings: warnings.slice(before) };
    return { frame: { ...frame, frame: copyFrame(frame.frame) }, claims };
  }
  return { frame, claims };
}

/** Compose the value notes with the options of this drawing, in footer order. */
export function columnValueNotes(domain: ColumnDomain): string[] {
  const { options } = domain;
  return [
    ...((options as { [CATEGORY_NOTES]?: string[] })[CATEGORY_NOTES] ?? []),
    ...knownPartsNote(domain),
    ...domain.shareNotes,
  ];
}

/** A total that misses a part adds the known parts; the note names the parts it lacks. */
function knownPartsNote(domain: ColumnDomain): string[] {
  if (domain.variant !== 'stacked' || domain.gtContent === null || domain.incompleteCats.size === 0) return [];
  const { options } = domain;
  return caveatNoteLine(options.strings!.knownPartsTotals!, domain.cats.flatMap((c, ci) => {
    if (!domain.incompleteCats.has(c.id)) return [];
    const missing = domain.dataSeries.filter((s) => s.vals[ci]!.v === null).map((s) => s.label);
    return [`${c.label ?? c.id} ${options.strings!.without} ${missing.join(` ${options.strings!.and} `)}`];
  }), options);
}

/** A ribbon chart's narrowest column as a share of the plot width. */
const RIBBON_COLUMN = 0.04;

/**
 * The widest plain segment value, so a ribbon chart's narrow column still
 * holds it. shortcut: plain value only; a share label (shareLabels) is wider
 * and falls back to the solver's outside seats.
 */
function widestSegmentValue(domain: ColumnDomain, font: FontSpec = { family: domain.theme.type.family, ...domain.theme.type.label }): number {
  const { dataSeries, cats, variant, measure } = domain;
  let widest = 0;
  for (const s of dataSeries) {
    cats.forEach((_, ci) => {
      const val = s.vals[ci]!;
      const v = domain.plottedOf(s, ci);
      if (v === null) return;
      const text = variant === 'stacked100'
        ? shareTextOf(domain, cats[ci]!.id, s.id, v, val.isPct)
        : domain.valueSpec.forSeries(s, val.format)(domain.absOf(s, ci)!);
      widest = Math.max(widest, measure(text, font).width);
    });
  }
  return widest;
}

/** Column width that fits the formatted segments and bold total at their drawing fonts. */
function requiredColumnValueWidth(domain: ColumnDomain): number {
  const { theme, measure, cats } = domain;
  const strong: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  // A 100% or mixed-sign total can differ from the sum of the positive parts.
  const widestTotal = Math.max(0, maxOf(cats.map((_, ci) => {
    const total = stackTotalText(domain, ci);
    return total && !total.net ? measure(total.text, strong).width : 0;
  })));
  return Math.max(widestSegmentValue(domain) + 10, widestTotal + 8);
}

/** The horizontal band depends on the frame's sides and key. Its category row also depends on height. */
function columnBandWidth(domain: ColumnDomain, frame: FrameResult, valueAxisReserve: number, tickFont: FontSpec, stair: boolean, valueWidth?: { px?: number }) {
  const { options, theme, measure, cats, va } = domain;
  let plotX0 = frame.plot.x + (va.show ? valueAxisReserve : 0);
  let plotW0 = va.show
    ? Math.max(10, frame.plot.w - valueAxisReserve)
    : frame.plot.w;
  // A grid panel can place its categories inside the plot; the plot keeps its edges.
  ({ x: plotX0, w: plotW0 } = insetRange(plotX0, plotW0, categoryInsetOf(options)));
  // Integrated comparator labels live in the inter-category lane. A quieter,
  // narrower default column leaves one consistent external label slot without
  // pretending the PY value is a segment inside the stack.
  // Ribbons: narrow columns, RIBBON_COLUMN of the
  // plot width at any period count or just wide enough for the widest segment
  // value, and half a column of outer padding, so the ribbons carry the space
  // between the columns.
  const narrow = domain.ribbonsOn && domain.ribbonRank;
  const ribbonColumn = narrow ? Math.min(0.15, Math.max(RIBBON_COLUMN, (widestSegmentValue(domain) + 8) / plotW0)) : 0;
  const ribbonFraction = ribbonColumn * (cats.length - 1) / (1 - 2 * ribbonColumn);
  // A grouped column in a grid panel slot sits a
  // little wider, at most PANEL_GROUP_BAR px per bar, so a wide slot does not
  // stretch its pairs into slabs.
  const grouped = domain.variant === 'grouped' && domain.dataSeries.length > 1;
  const panelGroup = options.bandFraction === undefined && !narrow && grouped && panelTypeClass(options) !== undefined;
  let bandFraction = panelGroup ? PANEL_GROUP_FRACTION : options.bandFraction ?? (narrow ? Math.min(0.7, Math.max(ribbonColumn, ribbonFraction)) : domain.pyRef ? (pyTickKeyed(domain, frame.legend) ? 0.5 : 0.42) : grouped ? COLUMN_FRACTION_MAX : columnBandFraction(plotW0, cats.length));
  const gapAfter = cats.map((c, ci) => {
    const authored = c.gapAfter === true ? 0.5 : typeof c.gapAfter === 'number' ? Math.max(0, c.gapAfter) : 0;
    // A total column stands apart: at least half a step before it, for its divider.
    const gap = cats[ci + 1]?.role === 'total' ? Math.max(authored, 0.5) : authored;
    // A category break needs a gap wide enough to carry its glyph.
    return c.breakAfter ? Math.max(gap, 0.5) : gap;
  });
  const bandFor = (x0: number, w: number) =>
    bandScale(cats.length, [x0, x0 + w], {
      paddingInner: 1 - bandFraction,
      // Histogram bins tile the number line: the plot ends at the outer bin edges.
      paddingOuter: narrow ? bandFraction / 2 : (options as { [TILED_BANDS]?: boolean })[TILED_BANDS] === true ? (1 - bandFraction) / 2 : (1 - bandFraction) / 2 + 0.05,
      gapAfter,
    });
  // Names at the right edge of the last column, or the left edge
  // of the first, need room outside the band, so the band gives it back
  // before anything is measured.
  const edgeNames = rightEdgeSeriesLabels(domain);
  const edgeLeft = options.seriesLabels?.at === 'left-edge';
  const edgeNeed = edgeNames.length === 0 ? 0 : maxOf(edgeNames.map((series) =>
    measure(series.label, edgeNameFont({ family: theme.type.family, ...theme.type.label }, domain)).width)) + RIGHT_EDGE_GAP;
  // The names first take the band's outer padding beside the edge column; the
  // band gives only the room they still lack, counting the room it gave before.
  let edgeGiven = 0;
  const edgePad = (x0: number, w: number) => {
    const band = bandFor(x0, w);
    return edgeLeft ? band.position(0) - x0 : x0 + w - (band.position(cats.length - 1) + band.bandwidth);
  };
  const giveEdgeRoom = () => {
    if (edgeNeed === 0 || (edgeGiven > 0 && edgeGiven + edgePad(plotX0, plotW0) >= edgeNeed)) return;
    let room = edgeNeed - edgeGiven;
    for (let pass = 0; pass < 4; pass++) {
      const x0 = edgeLeft ? plotX0 + room : plotX0;
      room = Math.max(0, Math.ceil(edgeNeed - edgeGiven - edgePad(x0, Math.max(10, plotW0 - room)) + 1));
    }
    room = Math.min(plotW0 - 10, room);
    if (edgeLeft) plotX0 += Math.max(0, room);
    plotW0 = Math.max(10, plotW0 - room);
    edgeGiven += Math.max(0, room);
  };
  giveEdgeRoom();
  // Staircase names run past the last column on the falling side; the band gives that room.
  if (stair) {
    const direction = staircaseDirection(domain.posTopP);
    const room = staircaseRoom({
      names: cats.map((c) => c.label ?? c.id), font: tickFont, measure, direction,
      edge: direction === 'right' ? frame.plot.x + frame.plot.w : plotX0, width: plotW0,
      centers: (r) => { const b = bandFor(direction === 'right' ? plotX0 : plotX0 + r, plotW0 - r); return cats.map((_, ci) => b.center(ci)); },
    });
    if (direction === 'left') plotX0 += room;
    plotW0 -= room;
  }
  // Grouped values print one font step down when one is wider than its column.
  // At that step, a value that still reaches over the next column is hidden,
  // and with it the whole series. Such a group widens until the stepped values
  // fit, when GROUPED_FRACTION_MAX of the category is enough for them; a group
  // that would still lose them keeps its width and the gap between the groups.
  const groupedValuesPrint = grouped && options.bandFraction === undefined && !narrow && !panelGroup && !domain.pyRef
    && contentOf(options, 'point', ['absolute']) !== null;
  const groupedValueW = groupedValuesPrint ? widestSegmentValue(domain, compactValueLabelFont(
    { family: theme.type.family, ...theme.type.label }, { family: theme.type.family, ...theme.type.footnote }, options.target, textScaleOf(options))) : 0;
  const groupedValuesNeed = (n: number) => n * (groupedValueW - 2) + 4 * (n - 1);
  const groupedValuesReach = groupedValuesPrint && (() => {
    const width = bandFor(plotX0, plotW0).bandwidth;
    if (groupedValueW <= groupedOffsets(width, domain.dataSeries.length)[0]!.size + 2 * Math.min(4, width * 0.08)) return false;
    const before = bandFraction;
    bandFraction = GROUPED_FRACTION_MAX;
    const widest = bandFor(plotX0, plotW0).bandwidth;
    bandFraction = before;
    return widest >= groupedValuesNeed(domain.dataSeries.length) - 0.01;
  })();
  // The column width: wide enough for its values, then capped (100% stack, grid panel group).
  const fitColumnWidth = () => {
    // A narrower default column never narrows below its widest value plus 5 px a
    // side, or its bold stack total plus 4 px a side (up to the share it had before), so a value
    // that printed inside or over it still does.
    if (options.bandFraction === undefined && !narrow && !domain.pyRef && !grouped) {
      const need = valueWidth?.px ?? requiredColumnValueWidth(domain);
      if (valueWidth) valueWidth.px = need;
      for (let pass = 0; pass < 3; pass++) {
        const width = bandFor(plotX0, plotW0).bandwidth;
        if (width >= need - 0.01 || bandFraction >= COLUMN_FRACTION_MAX) break;
        bandFraction = Math.min(COLUMN_FRACTION_MAX, bandFraction * need / width);
      }
    }
    // A group whose stepped values reach over the next column takes more of its
    // category, up to GROUPED_FRACTION_MAX, until each value fits over its own column.
    if (groupedValuesReach) {
      for (let pass = 0; pass < 3; pass++) {
        const width = bandFor(plotX0, plotW0).bandwidth;
        const need = groupedValuesNeed(domain.dataSeries.length);
        if (width >= need - 0.01 || bandFraction >= GROUPED_FRACTION_MAX) break;
        bandFraction = Math.min(GROUPED_FRACTION_MAX, bandFraction * need / width);
      }
    }
    // A 100% column is at most STACKED100_COLUMN_MAX px wide, so the room the edge names give
    // back does not make slabs.
    if (domain.variant === 'stacked100' && options.bandFraction === undefined && !narrow && panelTypeClass(options) === undefined) {
      for (let pass = 0; pass < 3; pass++) {
        const width = bandFor(plotX0, plotW0).bandwidth;
        if (width <= STACKED100_COLUMN_MAX + 0.01) break;
        bandFraction *= STACKED100_COLUMN_MAX / width;
      }
    }
    if (panelGroup) {
      const n = domain.dataSeries.length;
      const cap = PANEL_GROUP_BAR * n + 4 * (n - 1);
      for (let pass = 0; pass < 3; pass++) {
        const width = bandFor(plotX0, plotW0).bandwidth;
        if (width <= cap + 0.01) break;
        bandFraction *= cap / width;
      }
    }
  };
  fitColumnWidth();
  // A keyed PY tick prints its value alone right of the tick;
  // the gap between columns keeps room for it (lead, widest value, 4 px).
  const pyRef = domain.pyRef;
  if (pyRef && options.bandFraction === undefined && !narrow && pyTickKeyed(domain, frame.legend)) {
    const format = domain.valueSpec.forSeries(pyRef);
    const widest = Math.max(0, maxOf(cats.map((_, ci) => {
      const v = domain.plottedOf(pyRef, ci);
      return v === null ? 0 : measure(format(v), tickFont).width;
    })));
    const need = PY_TICK_LEAD + widest + 4;
    for (let pass = 0; pass < 3; pass++) {
      const probe = bandFor(plotX0, plotW0);
      if (probe.step - probe.bandwidth >= need - 0.01) break;
      bandFraction = Math.max(0.3, 1 - need / probe.step);
    }
  }
  // A column widened above for its values takes back outer padding the names
  // counted on; at a zero canvas margin a name then ran past the canvas and was
  // hidden. The names take the room they lack, and the columns fit again.
  for (let pass = 0; pass < 3; pass++) {
    const before = plotW0;
    giveEdgeRoom();
    if (plotW0 === before) break;
    fitColumnWidth();
  }
  return { band: bandFor(plotX0, plotW0), plotX0, plotW0, bandFor, valueWidth };
}

interface MeasuredColumnBand {
  stacks: ColumnDomain['stacks'];
  left: number;
  width: number;
  axis: number;
  axisShown: boolean;
  keyed: boolean;
  stair: boolean;
  plan: ReturnType<typeof columnBandWidth>;
}

// The search owns the entries. A prepared stack identifies its data, typography
// and format. Changing the plot sides, axis or category placement needs a new band.
const bandsBySearch = new WeakMap<object, MeasuredColumnBand[]>();

/** The data, typography and axis are fixed during one column's staircase padding retries. */
export interface ColumnStaircaseMemo {
  heightAxes?: 'auto' | 'fixed';
  acceptedPad?: { state: ReturnType<typeof staircaseState>; block: Rect; band: ColumnArea['band'] };
  growthTrial?: boolean;
  measureOpening?: boolean;
  prepareFallbackRow?: () => void;
  openingFrame?: ColumnHeightFrame;
  narrowGutters?: boolean;
  rowPlotAt?: (frameHeight: number, categoryBand: number) => { raw: number; minPlot: number };
  upperTrial?: (height: number) => ColumnHeightTrial | undefined;
  plotHeightAt?: (height: number) => number;
  scaleAt?: (frameHeight: number, pad: number) => Pick<ColumnArea, 'plot' | 'y' | 'y0'> | undefined;
  rotatedHeightAt?: (frameHeight: number) => number | undefined;
  stairFailsAt?: (frameHeight: number, reason: string) => boolean;
  plotAtPad?: { plot: Rect; at: (frame: FrameResult, pad: number) => ColumnArea };
  furniture?: ReturnType<typeof columnFrameFurniture> & { warnings: LintWarning[] };
  frame?: { frame: FrameResult; claims: OccupiedClaim[]; warnings: LintWarning[] };
  width?: { x: number; w: number; axis: number; keyed: boolean; plan: ReturnType<typeof columnBandWidth> };
}

/**
 * Band and tick measurement BEFORE the plot: the reserve must equal what the
 * measured labels need, and the wrap needs the band step, which
 * depends only on the final x-extent (frame minus axis reserve).
 */
function columnBand(
  domain: ColumnDomain,
  frame: FrameResult,
  valueAxisReserve: number,
  tickFont: FontSpec,
  warnings: LintWarning[],
  stair: boolean,
  beforeCategoryRow?: (bandwidth: number) => void,
  memo?: ColumnStaircaseMemo,
  heightSearch?: object,
  dimensionsOnly = false,
): Pick<ColumnArea, 'band' | 'catPlan' | 'intervalTicks'> {
  const { options, theme, measure, cats } = domain;
  const size = options.size;
  const search = heightSearch ?? ((memo || options.categoryLabels !== 'staircase') && domain.variant === 'stacked' && typeof size === 'object'
    ? columnHeightSearch.get(size) : undefined);
  const keyed = !!domain.pyRef && pyTickKeyed(domain, frame.legend);
  const { x, w } = frame.plot;
  const axisShown = !!domain.va.show;
  const title = planCategoryTitle(options, tickFont, measure, frame.plot.w - (axisShown ? valueAxisReserve : 0), warnings);
  const entries = search && bandsBySearch.get(search);
  const shared = entries?.find(entry => entry.stacks === domain.stacks && entry.left === x && entry.width === w
    && entry.axis === valueAxisReserve && entry.axisShown === axisShown && entry.keyed === keyed && entry.stair === stair);
  const cached = stair && memo ? memo.width : undefined;
  const same = cached && cached.x === x && cached.w === w && cached.axis === valueAxisReserve && cached.keyed === keyed;
  const width = shared?.plan ?? (same ? cached.plan : columnBandWidth(domain, frame, valueAxisReserve, tickFont, stair,
    // Axis and category placement change the bands, but the prepared stack still prints the same values.
    search ? entries?.find(entry => entry.stacks === domain.stacks)?.plan.valueWidth ?? {} : undefined));
  if (search && !shared) {
    const entry = { stacks: domain.stacks, left: x, width: w, axis: valueAxisReserve, axisShown, keyed, stair, plan: width };
    if (entries) entries.push(entry); else bandsBySearch.set(search, [entry]);
  }
  if (stair && memo && !same) memo.width = { x, w, axis: valueAxisReserve, keyed, plan: width };
  const { plotX0, plotW0, bandFor } = width;
  let band = width.band;
  beforeCategoryRow?.(band.bandwidth);
  // categoryAxis.dateTicks sets the interval; without it a long day row names its months.
  const authored = authoredDateTicks(cats, options, warnings);
  bandedCrossesBetween(options, warnings);
  // One cascade decides the whole row (wrap, font step, uniform
  // stride for dates, 45° for prose); no label is hidden by a local sweep.
  // A cut name takes a note mark and prints whole in the notes; once
  // several would be cut, the row reads as ranks with the mapping in the notes.
  const rowInput = (b: typeof band, ticked?: ReturnType<typeof dateTickRow>, rotate?: false) => {
    const toDate = partialAxisWords(options.strings, options, frame.legend?.items.some(item => item.id === RUNNING_PERIOD_LEGEND_ID) || partialNamedOnValues(domain));
    const row = categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings }, toDate, domain.running);
    ticked?.name(row);
    const input: Parameters<typeof planCategoryRow>[0] = {
      ...bandedCategoryStyle(options, theme, tickFont),
      ...row,
      centers: cats.map((_, ci) => b.center(ci)),
      step: b.step,
      periods: cats.length > 0 && cats.every(c => c.date !== undefined),
      measure,
      // Calendar ticks stay horizontal at every height. The same width can use the same row plan.
      plotHeight: domain.incompleteCats.size && measure === defaultMeasurer && row.calendar?.length === row.labels.length
        && row.calendar.every(Boolean) ? undefined : frame.plot.h,
      reference: { x: frame.plot.x, width: frame.plot.w },
      // A cut name takes a note mark only where its note prints.
      // Without the rank key, nominal names keep one name per column (rotate, then ellipsis).
      // Under notes.show 'ranks' alone a cut name takes no mark, since its note does not print.
      ...(disclosuresShown(options) ? { cutMarkFrom: authoredFootnoteCount(options) + 1 } : { everyName: true }),
      ...ticked?.plan,
      // An authored interval counts back from the latest period, as on a line.
      ...(ticked !== undefined && ticked === authored ? { ordered: true, strideFromEnd: true } : {}),
      ...(rotate === false ? { rotate } : {}),
    };
    return input;
  };
  const retainRotation = (input: ReturnType<typeof rowInput>, names: ReturnType<typeof measuredRotatedNames>) => {
    if (names && memo) memo.rotatedHeightAt = h => {
      const original = names(input.centers, width.band.step, h, plotW0);
      if (!original || original.inset === 0) return original?.height;
      const narrowed = bandFor(plotX0 + original.inset, plotW0 - original.inset);
      return names(cats.map((_, i) => narrowed.center(i)), narrowed.step, h, plotW0 - original.inset)?.height;
    };
  };
  const planRow = (b: typeof band, ticked?: ReturnType<typeof dateTickRow>, rotate?: false) => {
    const input = rowInput(b, ticked, rotate);
    const plan = planCategoryRow(input);
    if (!stair && memo?.heightAxes && b === width.band && rotate === undefined && !ticked && input.everyName
      && !domain.highlights.size && !cats.some(c => c.role === 'total' || c.date !== undefined)) {
      retainRotation(input, measuredRotatedNames(input));
    }
    // Rotated total and highlighted names need their drawn width for the row height and left overhang.
    if (plan.rotation !== 0) {
      const widest = () => Math.max(1, maxOf(plan.infos.filter((_, ci) => plan.keep[ci]).map(info => info.w)));
      const before = widest();
      const boldFont = { ...plan.font, weight: emphasisWeight(theme) };
      // The row plan cache shares infos with this plan, so the drawn widths go on copies.
      plan.infos = plan.infos.map((info, ci) => cats[ci]!.role === 'total' || domain.highlights.has(cats[ci]!.id)
        ? { ...info, w: Math.max(info.w, ...info.lines.map(line => measure(line, boldFont).width)) }
        : info);
      plan.rowHeight += (widest() - before) * (plan.rotation === 90 ? 1 : Math.SQRT1_2);
    }
    return plan;
  };
  // A staircase draws its names beside the columns. Only plan the bottom row
  // when a consumer needs it, for example a ratio tier or a total category's font.
  let planned: ReturnType<typeof planRow> | undefined;
  const catPlan = () => {
    if (planned) return planned;
    planned = planRow(band, authored);
    const ticked = authored ?? longDayMonths(cats, planned.stride, options.locale?.language);
    if (ticked && ticked !== authored) planned = planRow(band, ticked);
    // A rotated first name hangs left of its column; the band yields that much.
    if (!stair) ({ plan: planned, band } = yieldToRotatedName(planned, band, cats.length, plotX0, plotW0, bandFor, (b, rotate) => planRow(b, ticked, rotate)));
    if (title) planned = withCategoryTitle(planned, title, !stair && kindSetting(options, 'category') !== false && cats.length > 0);
    return planned;
  };
  // The band must be final before return. Authored footnote warnings retain their order.
  if (dimensionsOnly) {
    if (!authored && !domain.highlights.size
      && !cats.some(c => c.role === 'total' || c.date !== undefined || c.footnote !== undefined)) {
      const input = rowInput(band);
      if (input.everyName) retainRotation(input, openingRotatedNames(input));
    }
  } else if (!stair || cats.some(c => c.footnote !== undefined)) catPlan();
  return { band, catPlan, ...(authored?.ticks ? { intervalTicks: authored.ticks } : {}) };
}

/**
 * The headroom a growth bracket whose label sits on its run takes over the plot. The run sits
 * 33 px under the plot top (annotateArms ON_ARM_TOP) and at least 18 px over the stack it
 * points to, so it shares the domain headroom over the tallest stack with that stack's total.
 */
export const CAGR_ON_ARM_ROOM = 26;
/** The widest a 100% column draws by default. */
const STACKED100_COLUMN_MAX = 110;
/** The least such headroom: the label's lower half and air, where rows over the plot already give the air. */
const CAGR_ON_ARM_MIN = 16;

/** The plot rect: reserve category band, grand-total headroom, cagr arm room; then the value scale. */
/**
 * A `diff` or `delta` between the totals of two columns that are not neighbours: a total difference. It draws as the growth bracket over the columns, as a `cagr` does, with the
 * difference for its label. `placement: 'label'` keeps the arrow between the columns.
 */
export function bracketsOverColumns(annotation: Annotation, domain: Pick<ColumnDomain, 'cats' | 'dataSeries'>): boolean {
  if ((annotation.kind !== 'diff' && annotation.kind !== 'delta') || annotation.placement === 'label') return false;
  const [from, to] = annotation.kind === 'diff' ? [annotation.from, annotation.to] : [annotation.vs, annotation.at];
  // A column's total: the category itself, or the one series a single-series chart stacks.
  const index = (ref: unknown) => {
    const id = typeof ref === 'string' ? ref
      : ref !== null && typeof ref === 'object' && 'categoryId' in ref && ((ref as { seriesId?: Id }).seriesId === undefined || (domain.dataSeries.length === 1 && (ref as { seriesId?: Id }).seriesId === domain.dataSeries[0]!.id)) ? (ref as { categoryId: Id }).categoryId : undefined;
    return id === undefined ? -1 : domain.cats.findIndex((cat) => cat.id === id);
  };
  const [i, j] = [index(from), index(to)];
  return i >= 0 && j >= 0 && Math.abs(i - j) > 1;
}

export function columnPlotArea(
  domain: ColumnDomain,
  frame: FrameResult,
  warnings: LintWarning[],
  beforeCategoryRow?: (bandwidth: number) => void,
  widthMemo?: ColumnStaircaseMemo,
  noteArea?: ColumnArea,
  keylessLimit = false,
): ColumnArea {
  const { options, theme, size, measure, variant, va, fmt, valueSpec, cats, dLo, dHi } = domain;
  const saved = widthMemo?.plotAtPad;
  if (saved?.plot === frame.plot && !beforeCategoryRow && staircaseOn(options.categoryLabels, options)) {
    return saved.at(frame, staircaseState(options).pad);
  }
  const warningStart = warnings.length;
  // Percent cells print '%' on the ticks as on the value labels (fmtPercent).
  const percentAxis = variant !== 'stacked100' && percentCellsOnly(domain.dataSeries);
  const axisFmt = variant === 'stacked100' ? (v: number) => formatAutomaticPercent(v, 0, false, options.locale?.language) : percentAxis ? valueSpec.fmtPercent : fmt;
  const axisSpec = variant === 'stacked100' ? undefined : percentAxis ? valueSpec.percentSpec : valueSpec.spec;
  const valueAxisReserve = va.show
    ? measureValueAxisWidth([dLo, dHi], axisFmt, theme, measure, 5, axisSpec)
    : 0;
  const ratioTierPrepared = prepareRatioTier(
    options.ratioTier,
    cats,
    domain.seriesNorm,
    theme,
    measure,
    Math.max(10, frame.plot.w - valueAxisReserve),
    undefined, options.target, notApplicableGlyph(options.strings), options.locale?.language,
  );
  pushAll(warnings, ratioTierPrepared.warnings);
  const tier = ratioTierPrepared.tier;

  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const gtH = measure('0', strongFont).height;
  const hasCagr = (options.annotations ?? []).some((a) => a.kind === 'cagr' || bracketsOverColumns(a, domain));
  const integratedGrowthH = domain.pyRef && kindSetting(options, 'growth') !== false ? measure('+88.8%', strongFont).height + 4 : 0;
  // The rule sentence is engine-added furniture, so it computes its reserve
  // in the SAME decision that adds it instead of hunting for a free
  // slot later: an all-negative 60-column torture leaves no gap inside the
  // plot, and a corridor whose rule went missing is the silent lie this
  // preset exists to prevent. Wrapped against the frame width, which is
  // already known and does not depend on this reserve.
  const ruleText = options.anomaly?.label ?? '';
  const ruleOn = ruleText !== '' && kindSetting(options, 'valueLine') !== false;
  // The rule sentence AS RENDERED: it carries its own suppression trace.
  const ruleWrap = ruleOn ? fitText(ruleText, tickFont, Math.max(80, frame.plot.w - 8), 4, measure, { target: options.target, textScale: textScaleOf(options), typeRole: 'footnote' }) : undefined;
  const ruleH = ruleWrap ? ruleWrap.lines.length * tickFont.size * 1.2 + 6 : 0;
  // A drawn value axis carries its "Measure, unit" title in
  // the head band, under the rule sentence.
  const axisTitle = va.show && axisTitleAllowed(options.labels)
    ? planValueAxisTitle(valueAxisTitleText(theme, options.axisTitles?.primary, options,
      valueAxisUnit(options.unit, domain.dataSeries, variant === 'stacked100')), theme, measure, frame.plot.w)
    : undefined;
  // Staircase names replace the category row (options.categoryLabels).
  const stair = staircaseOn(options.categoryLabels, options) && kindSetting(options, 'category') !== false && cats.length > 1;
  const bandWarnings = warnings.length;
  const bandLifts = zeroLifts.count;
  // The segment note can move the frame. Reuse its parent's horizontal positions
  // and category row only when the frame supplied the same space and key.
  const savedBand = noteArea?.quietBand && sameContent(noteArea.frame.plot, frame.plot)
    && sameContent(noteArea.frame.legend, frame.legend) ? noteArea : undefined;
  const { band, catPlan, intervalTicks } = savedBand ?? columnBand(domain, frame, valueAxisReserve, tickFont, warnings, stair, beforeCategoryRow, widthMemo);
  const quietBand = warnings.length === bandWarnings && zeroLifts.count === bandLifts;
  const showCatRow = kindSetting(options, 'category') !== false && cats.length > 0 && !stair;
  if (showCatRow) pushAll(warnings, catPlan().warnings);
  const categoryTitle = options.categoryAxis?.title ? catPlan().title : undefined;
  const rowHeight = showCatRow && keylessLimit
    ? categoryHeightLimit(cats, theme, measure) + (categoryTitle?.bandHeight ?? 0)
    : undefined;
  const tickReserve = showCatRow || categoryTitle ? (rowHeight ?? catPlan().rowHeight) + 8 : 0;
  // With a ratio tier the band additionally carries the tier's 19px caption
  // rhythm minus the tierGap the tier adds back below the band — the
  // same arithmetic as line's tier branch. The caption gap is a between-blocks
  // band owned by the tier, so the tick-band record reports only
  // `tickReserve`, the tick-row component.
  const catBandH = tier
    ? 6 + catPlan().rowHeight + ratioTierMetrics.categoryCaptionGap - theme.space.tierGap
    : tickReserve;
  const ratioTierHeight = tier?.reserveHeight ?? 0;
  // The category row reads under the lowest column and the value
  // hanging under a column: a grouped column's own value (after its flag),
  // or the total of a stack with nothing above zero. The plot makes that room.
  const lowest = Math.min(0, minOf(domain.negBotP));
  // A grouped column hangs a value only while point labels print (or an
  // anomaly flag stands there): under labels.point false a negative column
  // kept an empty label row under it.
  const pointsHang = variant === 'grouped' && (kindSetting(options, 'point') !== false || domain.anomaly !== undefined);
  const hangingEnd = Math.min(0, minOf(cats.map((_, ci) =>
    pointsHang || (domain.gtContent && domain.posTopP[ci]! <= 0) ? domain.negBotP[ci]! : 0)));
  const hangingRoom = showCatRow && options.labels !== false
    ? Math.max(measure('0', labelFont).height, gtH) + 4 + (domain.anomaly ? ANOMALY_FLAG_GAP + ANOMALY_FLAG_H : 0)
    : 0;
  // A stack total sits 4px over its stack (band/totals.ts), mostly inside
  // the headroom the domain keeps. The row over the plot holds only what
  // that headroom does not; a fixed label-height row there held nothing.
  // A broken axis moves its stacks unevenly and keeps the fixed row. The
  // headroom is read on the plot the hanging labels under it leave.
  // A growth bracket with its label on its run needs no label row over the run, but keeps its
  // air under the header: rows already over the plot count toward it.
  const axisTitleH = valueAxisTitleBand(axisTitle, theme, measure);
  const cagrRoom = Math.max(CAGR_ON_ARM_MIN, CAGR_ON_ARM_ROOM - axisTitleH - ruleH - integratedGrowthH);
  // Room the on-run label frees under a 30 px headroom goes to the plot at an engine-chosen height.
  if (hasCagr && cagrRoom < 30) recordFreedChrome(frame.frame, 'cagr-headroom', 30 - cagrRoom);
  const cagrPad = (options as { [CAGR_PAD]?: number })[CAGR_PAD] ?? 0;
  // The room a growth arm adds over the plot for its legs counts as frame at an
  // engine-chosen height, as the freed headroom does, so the plot keeps its height and the canvas grows.
  if (hasCagr && cagrPad > 0) recordFreedChrome(frame.frame, 'cagr-pad', cagrPad);
  const growthAndCagr = integratedGrowthH + (hasCagr ? cagrRoom + cagrPad : 0);
  const headerAt = (frameHeight: number, categoryBand: number, underLabels = hangingRoom) => {
    const unrowedH = frameHeight - categoryBand - ratioTierHeight - 8 - axisTitleH - growthAndCagr - ruleH;
    const unrowedPlotH = unrowedH - hangingLabelReserve(unrowedH, [dLo, dHi], hangingEnd, underLabels);
    const totalsRow = !domain.gtContent ? 0 : domain.activeBreak ? gtH + 6
      : Math.max(0, maxOf(domain.posTopP.map(top => (top > 0 ? seatRoom(top, [dLo, dHi], gtH + 4, unrowedPlotH) : 0))));
    return totalsRow + growthAndCagr;
  };
  const headerRows = headerAt(frame.plot.h, catBandH);
  const axisTitleBand = valueAxisTitleBand(axisTitle, theme, measure, headerRows);
  if (!stair && options.categoryLabels !== 'staircase' && ['fit', 'wrap', 'font-down', 'stride'].includes(catPlan().step)
    && !options.annotations?.some(annotation => annotation.kind === 'cagr' || annotation.kind === 'event' || bracketsOverColumns(annotation, domain))
    && ![CAGR_PAD, VALUE_LINE_RESERVE, TICK_LABEL_RESERVE, BAND_PAD].some(marker => marker in options)) {
    fixedPlotChrome(frame);
    const chrome = plotChromeFloor.get(frame.frame);
    if (chrome !== undefined) {
      // Each headroom constraint is affine in canvas height; their intersection gives the floor.
      const q = hangingEnd < 0 && hangingRoom > 0 && dHi > dLo ? (hangingEnd - dLo) / (dHi - dLo) : 0;
      const room = hangingEnd < 0 ? hangingRoom : 0;
      const bare = chrome + catBandH + ratioTierHeight + 8 + valueAxisTitleBand(axisTitle, theme, measure) + growthAndCagr + ruleH;
      const unrowed: [number, number][] = [[1, -bare], [1 / (1 - q), -(bare + room) / (1 - q)]];
      const headers: [number, number][] = [[0, growthAndCagr], [0, axisTitle ? measure('0', tickFont).height / 2 : 0]];
      if (domain.gtContent && domain.activeBreak) headers.push([0, growthAndCagr + gtH + 6]);
      else if (domain.gtContent) for (const top of domain.posTopP) {
        const free = (dHi - top) / (dHi - dLo);
        if (!(top > 0 && free >= 0 && free < 1)) continue;
        for (const [a, b] of unrowed) headers.push([-free * a / (1 - free), growthAndCagr + (gtH + 4 - free * b) / (1 - free)]);
      }
      const base = chrome + catBandH + ratioTierHeight + 8 + (axisTitle?.height ?? 0) + ruleH;
      const plots = headers.flatMap(([a, b]): [number, number][] => [[1 - a, -base - b], [(1 - a) / (1 - q), (-base - b - room) / (1 - q)]]);
      const pixels = PLOT_FLOOR_PX[options.target ?? DEFAULT_TARGET];
      const pixelHeight = maxOf(plots.map(([a, b]) => (pixels - b) / a));
      // The narrow-card retry raises the share from 0.4 to 0.5. When even the
      // stronger bound is below the pixel floor, the fixed drawing is identical.
      const pixelBound = variant === 'stacked' && size.width < NARROW_SHARE_WIDTH && hasCompleteTextWidths(measure)
        && plots.every(([a, b]) => a > PLOT_FLOOR_SHARE && b <= 0 && -b / (a - PLOT_FLOOR_SHARE) <= pixelHeight);
      const share = pixelBound ? undefined : plotFloorShare(size.width, options);
      const height = share === undefined ? pixelHeight : Math.max(pixelHeight, maxOf(plots.map(([a, b]) => -b / (a - share))));
      const plotAtFloor = minOf(plots.map(([a, b]) => a * height + b));
      if (q >= 0 && q < 1 && Number.isFinite(height)
        && Math.min(...unrowed.map(([a, b]) => a * height + b)) >= 0) fixedPlotChrome(frame, height - plotAtFloor - chrome);
      else plotChromeFloor.delete(frame.frame);
    }
  }
  // A padding retry changes only the vertical scale on this same frame. Keep a
  // fresh plot and public frame for each trial, including its own minimum height.
  if (stair && widthMemo?.frame && widthMemo.frame.frame.plot === frame.plot && !beforeCategoryRow
    && variant === 'stacked' && !domain.activeBreak && !tier && !hasCagr && warnings.length === warningStart
    && !cats.some(category => category.footnote !== undefined)) {
    widthMemo.plotAtPad = { plot: frame.plot, at: atPad };
  }
  if (widthMemo?.heightAxes && widthMemo.plotHeightAt && typeof options.size === 'object' && !axisTitle && !categoryTitle && !tier && !ruleH
    && !growthAndCagr && !ratioTierHeight && !domain.activeBreak && !domain.incompleteCats.size && !(BAND_PAD in options)) {
    const search = columnHeightSearch.get(options.size);
    if (search && stair && widthMemo.plotAtPad && catBandH === 0 && hangingRoom === 0) {
      // With enough domain headroom, the staircase has no header row above its eight-pixel gap.
      // Re-evaluate that condition for the candidate height before reusing this vertical scale.
      const tallest = maxOf(domain.posTopP);
      const [lo, hi] = [dLo, dHi];
      widthMemo.scaleAt = (frameHeight, pad) => {
        if (domain.gtContent && tallest > 0 && seatRoom(tallest, [lo, hi], gtH + 4, frameHeight - 8) > 0) return;
        const topPad = 8 + pad;
        const plot = { x: frame.plot.x + valueAxisReserve, w: Math.max(10, frame.plot.w - valueAxisReserve),
          y: frame.plot.y + topPad, h: Math.max(10, frameHeight - topPad) };
        const y = linearScale([lo, hi], [plot.y + plot.h, plot.y]);
        return { plot, y, y0: y(0) };
      };
      if (widthMemo.measureOpening) {
        widthMemo.prepareFallbackRow = () => {
          columnBand(domain, frame, valueAxisReserve, tickFont, [], false, undefined, widthMemo, search, true);
          const room = options.labels === false ? 0 : Math.max(measure('0', labelFont).height, gtH) + 4;
          const minPlot = plotFloorRows(options) * measure('0', labelFont).height + 8;
          widthMemo.rowPlotAt = (frameHeight, categoryBand) => {
            const raw = frameHeight - categoryBand - (8 + headerAt(frameHeight, categoryBand, room));
            return { raw: raw - hangingLabelReserve(raw, [dLo, dHi], hangingEnd, room), minPlot };
          };
        };
      }
    } else if (search && !stair && showCatRow) {
      widthMemo.rotatedHeightAt ??= frameHeight => {
        const row = columnBand(domain, { ...frame, plot: { ...frame.plot, h: frameHeight } },
          valueAxisReserve, tickFont, [], false, undefined, widthMemo, search).catPlan();
        return row.step === 'rotate' && !row.cutNotes.length ? row.rowHeight : undefined;
      };
      if (widthMemo.growthTrial) {
        const minPlot = plotFloorRows(options) * measure('0', labelFont).height + 8;
        widthMemo.rowPlotAt = (frameHeight, categoryBand) => {
          const raw = frameHeight - categoryBand - (8 + headerAt(frameHeight, categoryBand));
          return { raw: raw - hangingLabelReserve(raw, [dLo, dHi], hangingEnd, hangingRoom), minPlot };
        };
      }
    }
  }
  return atPad(frame, stair ? staircaseState(options).pad : 0);

  function atPad(frame: FrameResult, pad: number): ColumnArea {
    const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
    const baseTopPad = 8 + axisTitleBand + headerRows + ruleH + pad;
    const plotH0NoBand = frame.plot.h - catBandH - ratioTierHeight - baseTopPad;
    const hangingReserveNoBand = hangingLabelReserve(plotH0NoBand, [dLo, dHi], hangingEnd, hangingRoom);
    const minRawH = Math.max(10, options.mode === 'compact' ? 80 : 0);
    let bandPad = rawBandPad > 0 ? Math.max(0, Math.min(rawBandPad, Math.floor(plotH0NoBand - hangingReserveNoBand - minRawH))) : 0;
    while (
      bandPad > 0 &&
      frame.plot.h - catBandH - ratioTierHeight - (baseTopPad + bandPad) -
        hangingLabelReserve(frame.plot.h - catBandH - ratioTierHeight - (baseTopPad + bandPad), [dLo, dHi], hangingEnd, hangingRoom) <
        minRawH
    ) {
      bandPad--;
    }
    const topPad = baseTopPad + bandPad;
    const plotH0 = frame.plot.h - catBandH - ratioTierHeight - topPad;
    const hangingReserve = hangingLabelReserve(plotH0, [dLo, dHi], hangingEnd, hangingRoom);
    const plot: Rect = {
      x: frame.plot.x,
      y: frame.plot.y + topPad,
      w: frame.plot.w,
      h: plotHeightAfter(frame, size.height, plotH0 - hangingReserve),
    };
    // event keys and rotated categories cannot consume the mark area.
    const minPlot = plotFloorRows(options) * measure('0', labelFont).height + 8;
    frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, size.height + (frame.deficit ?? 0) + minPlot - (plotH0NoBand - hangingReserveNoBand));
    // value axis: measure first, shrink the plot, gridlines behind marks
    if (va.show) {
      plot.x += valueAxisReserve;
      plot.w = Math.max(10, plot.w - valueAxisReserve);
    }
    const y = domain.activeBreak
      ? brokenLinearScale([dLo, dHi], [plot.y + plot.h, plot.y], domain.activeBreak)
      : linearScale([dLo, dHi], [plot.y + plot.h, plot.y]);
    return {
      frame, axisFmt, axisSpec, tier, tickFont, labelFont, strongFont, gtH, ruleOn, ruleText, ruleWrap, ruleH, axisTitle, axisTitleBand, topPad, band,
      quietBand, catPlan, ...(intervalTicks ? { intervalTicks } : {}), showCatRow, tickReserve, catBandH: catBandH + hangingReserve,
      // The names may rise to the frame top, under the rule and the axis title.
      ...(stair ? { stairTop: frame.plot.y + ruleH + (axisTitle ? axisTitle.height + 8 : 0) } : {}),
      // A date row stays at the plot's bottom band; prose reads under the
      // lowest column and the value hanging under it.
      get catRowY() { return catPlan().dateNumeric ? plot.y + plot.h + hangingReserve : categoryRowTop(y, lowest, hangingEnd, hangingRoom); },
      plot, y, y0: y(0),
    };
  }
}
