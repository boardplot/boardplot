import { chartString } from '../../strings/column';
import { stringFields } from '../../strings';
import { DEFAULT_TARGET, scaleTextPx } from '../../target';
/**
 * Column phase 1, frame and scale: the legend, the margins and the frame,
 * then the reserves around the plot, the band, the category row and the
 * value scale.
 */

import { BAND_PAD, VALUE_LINE_RESERVE } from '../../annotateParts';
import { axisTitleAllowed, measureValueAxisWidth, planValueAxisTitle, valueAxisTitleBand, valueAxisTitleText, valueAxisUnit } from '../../axis';
import { longDayMonths, type dateTickRow } from '../../calendarLabels';
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
  type FrameBand,
  type FrameInput,
  type FrameResult,
  type LegendItemInput,
  authoredFootnoteCount, authoredNotes, noteLine, type NoteCapOptions } from '../../frame';
import type { Rect } from '../../geometry';
import { categoryRowTop, hangingLabelReserve, planCategoryRow, rotatedLeftOverhang } from '../../label/categoryRow';
import { fitText } from '../../label/fitText';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { scenarioLegendKeys } from '../../label/legendFidelity';
import { partialAxisWords, partialFootnotes, partialLegendKeys, toDateFont } from '../../partialPeriod';
import { prepareRatioTier, ratioTierCanRender, ratioTierMetrics } from '../../ratioTier';
import { bandScale, brokenLinearScale, linearScale, seatRoom } from '../../scale';
import type { FontSpec } from '../../text';
import { canvasMargin, panelTypeClass, emphasisWeight, strokeToken, dashToken, secondaryFont } from '../../theme';
import type { Id } from '../../types/cell';
import type { LegendOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { edgeNameFont, edgeNamesReplaceKey, kindSetting, partialNamedOnValues, pyTickKeyed, rightEdgeSeriesLabels, RIGHT_EDGE_GAP, shareTextOf } from './domain';
import { ANOMALY_FLAG_GAP, ANOMALY_FLAG_H, TICK_LABEL_RESERVE, PY_TICK_LEAD, type ColumnArea, type ColumnDomain, type NormSer } from './model';
import { seriesPattern, signWord, type ColumnLegendPaints } from './paints';
import { signPaint } from '../band/sign';
import { anomalyLegendItems, anomalyRuleLines, anomalyRuleReserve } from './anomaly';
import { segmentHatchGround } from './marks';
import { referenceMarkerKey } from '../band/ticks';
import { netLineName } from '../band/stacks';
import { categoryRanksLint, FORCE_CATEGORY_RANKS, withCategoryRanks } from '../combo/categoryRanks';
import { disclosuresShown, knownPartsLead, rankKeyShown } from '../../notes';
import { categoryLabelsAndMarks } from '../../footnoteMark';
import { staircaseDirection, staircaseOn, staircaseRoom, staircaseState } from '../../label/staircase';
import { textScaleOf } from '../../typeFloors';
import { PLOT_FLOOR_PX, plotFloorRows, plotFloorShare } from '../../sizing';
import { partialWords, stackTotalText } from './labels';
import { maxOf, minOf, pushAll } from '../../arrays';

/** Internal layout marker (histogram): the bands tile the plot with no outer padding. Authored JSON cannot set it. */
export const TILED_BANDS = Symbol('tiledBands');

/**
 * Internal option: the segment values a first pass could not print on their
 * columns, which the note line names. Set by
 * `layoutColumn` on its second pass; authored JSON cannot.
 */
export const SEGMENT_NOTE = Symbol('segmentNote');
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
  const looks = domain.cats.flatMap((c, ci) => {
    const v = domain.plottedOf(s, ci);
    if (v === null || (domain.variant !== 'grouped' && v === 0)) return [];
    return [{ paint: paints.cell(s, s.vals[ci]!, c, i), pattern: paints.pattern(s, s.vals[ci]!, c) }];
  });
  const first = looks[0];
  if (!first || looks.some((look) => look.pattern !== first.pattern || paints.css(look.paint) !== paints.css(first.paint))) return {};
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
    : dataSeries.map((s, i) => ({
        id: s.id,
        label: s.label,
        paint: legendUsesSeriesIdentity ? paints.identity(s, i) : paints.base(s, i),
        pattern: legendUsesSeriesIdentity ? undefined : seriesPattern(s),
        // A series whose every drawn column looks the same is keyed in that look, hatch included.
        ...uniformCellLook(domain, paints, s, i),
      }));
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
    ...partialLegendKeys(paints.partialHatch && !partialNamedOnValues(domain), domain.options.strings, domain.cats),
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
const COLUMN_FRACTION_MAX = 0.7;

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
    options.legend === undefined && legendForcedByEncoding ? 'top' : options.legend;
  if (!effectiveLegend || effectiveLegend === 'none' || effectiveLegend === 'auto') return undefined;
  const legendOpts: LegendOptions = normalizeLegendOption(effectiveLegend);
  let items = columnLegendItems(domain, paints);
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
 * When the event key puts a row above the plot and the chart has no
 * key of its own, the row also names what the columns paint beyond their one
 * series (a partial period's hatch), so the row keys every pattern on the page.
 */
function bandKeyRow(domain: ColumnDomain, paints: ColumnLegendPaints, eventKey: FrameBand | undefined): FrameInput['legend'] {
  if (!eventKey?.legend?.length) return undefined;
  const single = domain.dataSeries.length === 1 ? domain.dataSeries[0]!.id : undefined;
  const items = columnLegendItems(domain, paints).filter((item) => item.id !== single);
  return { options: { position: 'top' }, items };
}

/** The frame, with the legend, the event key and the right-margin decoration reserve; claims into its own index. */
export function solveColumnFrame(
  domain: ColumnDomain,
  paints: ColumnLegendPaints,
  warnings: LintWarning[],
  eventKey?: FrameBand,
): { frame: FrameResult; claims: OccupiedIndex } {
  const { options, theme, size, measure, anomaly, corridorShown, statFmt, netLineOn, netLineSeries, variant } = domain;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const decorationFont = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  // Every anomaly rule the engine draws carries its value in the right margin.
  // The width is reserved HERE, before the frame is solved, so the label fits
  // by construction instead of being drawn wherever it lands.
  const anomalyRuleLabelWidth = anomaly?.usable
    ? anomalyRuleReserve(anomalyRuleLines(theme, anomaly, corridorShown, statFmt, { token: 'warn' }, options.strings), { family: theme.type.family, ...theme.type.label }, measure)
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
  if (domain.cats.length > 0 && categoryWidth > (size.width - margin.left - margin.right - axisReserve) / domain.cats.length) {
    const gutter = measure('0', axisFont).height;
    if (options.margin?.left === undefined) margin.left = Math.min(margin.left, gutter);
    if (options.margin?.right === undefined) margin.right = Math.max(decorationRight, Math.min(margin.right, gutter));
  }
  // a hidden valueLine label's margin wins over an authored one, which would hide it again.
  margin.right = Math.max(margin.right, (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ?? 0,
    (options as { [TICK_LABEL_RESERVE]?: number })[TICK_LABEL_RESERVE] ?? 0);
  const legend = columnLegend(domain, paints, warnings) ?? bandKeyRow(domain, paints, eventKey);
  const frame = solveFrame(
    {
      size,
      margin,
      ...frameTextOptions(options),
      footnotes: [
        ...partialFootnotes(domain.cats, options.strings, legend?.items.some(item => item.id === '__partial') || partialNamedOnValues(domain)), ...authoredNotes(options),
        // Above 8 values the note counts them against all drawn values.
        ...noteLine(options.strings!.valuesNotOnColumns!, (options as { [SEGMENT_NOTE]?: string[] })[SEGMENT_NOTE] ?? [], options,
          domain.dataSeries.reduce((sum, series) => sum + series.vals.filter((cell) => cell.v !== null).length, 0)),
        ...((options as { [CATEGORY_NOTES]?: string[] })[CATEGORY_NOTES] ?? []),
        ...partialTotalsNote(domain, options),
      ],
      legend,
      ...(eventKey ? { eventKey } : {}),
      theme,
      measure,
    },
    claims,
  );
  return { frame, claims };
}

/** A total that misses a part adds the known parts; the note names the parts it lacks. */
function partialTotalsNote(domain: ColumnDomain, options: NoteCapOptions): string[] {
  if (domain.variant !== 'stacked' || domain.gtContent === null) return [];
  return noteLine(knownPartsLead(domain.options), domain.cats.flatMap((c, ci) => {
    if (!domain.incompleteCats.has(c.id)) return [];
    const missing = domain.dataSeries.filter((s) => s.vals[ci]!.v === null).map((s) => s.label);
    return [`${c.label ?? c.id} ${domain.options.strings!.without} ${missing.join(` ${domain.options.strings!.and} `)}`];
  }), options);
}

/** A ribbon chart's narrowest column as a share of the plot width. */
const RIBBON_COLUMN = 0.04;

/**
 * The widest plain segment value, so a ribbon chart's narrow column still
 * holds it. shortcut: plain value only; a share label (shareLabels) is wider
 * and falls back to the solver's outside seats.
 */
function widestSegmentValue(domain: ColumnDomain): number {
  const { dataSeries, cats, variant, theme, measure } = domain;
  const font: FontSpec = { family: theme.type.family, ...theme.type.label };
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
): Pick<ColumnArea, 'band' | 'catPlan'> {
  const { options, theme, measure, cats, va } = domain;
  let plotX0 = frame.plot.x + (va.show ? valueAxisReserve : 0);
  let plotW0 = va.show
    ? Math.max(10, frame.plot.w - valueAxisReserve)
    : frame.plot.w;
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
  const bandFor = (x0: number, w: number) =>
    bandScale(cats.length, [x0, x0 + w], {
      paddingInner: 1 - bandFraction,
      // Histogram bins tile the number line: the plot ends at the outer bin edges.
      paddingOuter: narrow ? bandFraction / 2 : (options as { [TILED_BANDS]?: boolean })[TILED_BANDS] === true ? (1 - bandFraction) / 2 : (1 - bandFraction) / 2 + 0.05,
      gapAfter: cats.map((c, ci) => {
        const authored = c.gapAfter === true ? 0.5 : typeof c.gapAfter === 'number' ? Math.max(0, c.gapAfter) : 0;
        // A total column stands apart: at least half a step before it, for its divider.
        const gap = cats[ci + 1]?.role === 'total' ? Math.max(authored, 0.5) : authored;
        // A category break needs a gap wide enough to carry its glyph.
        return c.breakAfter ? Math.max(gap, 0.5) : gap;
      }),
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
  // The column width: wide enough for its values, then capped (100% stack, grid panel group).
  const fitColumnWidth = () => {
    // A narrower default column never narrows below its widest value plus 5 px a
    // side, or its bold stack total plus 4 px a side (up to the share it had before), so a value
    // that printed inside or over it still does.
    if (options.bandFraction === undefined && !narrow && !domain.pyRef && !grouped) {
      const strong: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
      // The total as its label prints it: on a 100% or mixed-sign stack that is not the sum of the drawn positive parts.
      const widestTotal = Math.max(0, maxOf(cats.map((_, ci) => {
        const total = stackTotalText(domain, ci);
        const words = partialWords(domain, ci);
        return total && !total.net ? Math.max(measure(total.text, strong).width, words ? measure(words, toDateFont(theme)).width : 0) : 0;
      })));
      const need = Math.max(widestSegmentValue(domain) + 10, widestTotal + 8);
      for (let pass = 0; pass < 3; pass++) {
        const width = bandFor(plotX0, plotW0).bandwidth;
        if (width >= need - 0.01 || bandFraction >= COLUMN_FRACTION_MAX) break;
        bandFraction = Math.min(COLUMN_FRACTION_MAX, bandFraction * need / width);
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
  let band = bandFor(plotX0, plotW0);
  // One cascade decides the whole row (wrap, font step, uniform
  // stride for dates, 45° for prose); no label is hidden by a local sweep.
  // A cut name takes a note mark and prints whole in the notes; once
  // several would be cut, the row reads as ranks with the mapping in the notes.
  const planRow = (b: typeof band, ticked?: ReturnType<typeof dateTickRow>) => {
    const row = categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings }, partialAxisWords(options.strings, options, frame.legend?.items.some((item) => item.id === '__partial') || partialNamedOnValues(domain)));
    ticked?.name(row);
    return withCategoryRanks(planCategoryRow({
      target: options.target, textScale: textScaleOf(options),
      ...row,
      centers: cats.map((_, ci) => b.center(ci)),
      step: b.step,
      fonts: [tickFont, { ...tickFont, size: tickFont.size - scaleTextPx(1, textScaleOf(options)) }, { family: theme.type.family, ...theme.type.footnote }],
      secondary: secondaryFont(theme), periods: cats.length > 0 && cats.every(c => c.date !== undefined),
      padding: 4,
      measure,
      plotHeight: frame.plot.h,
      reference: { x: frame.plot.x, width: frame.plot.w },
      // A cut name takes a note mark only where its note prints.
      // Without the rank key, nominal names keep one name per column (rotate, then ellipsis).
      // Under notes.show 'ranks' alone a cut name takes no mark, since its note does not print.
      ...(disclosuresShown(options) ? { cutMarkFrom: authoredFootnoteCount(options) + 1 } : rankKeyShown(options) ? {} : { everyName: true }),
      ...ticked?.plan,
    }), measure, cats.map((c) => c.label ?? c.id), (options as { [FORCE_CATEGORY_RANKS]?: true })[FORCE_CATEGORY_RANKS] === true, rankKeyShown(options));
  };
  let catPlan = planRow(band);
  const ticked = longDayMonths(cats, catPlan.stride, options.locale?.language);
  if (ticked) catPlan = planRow(band, ticked);
  // A rotated first name hangs left of its column; the band yields that much.
  const catOverhang = stair ? 0 : rotatedLeftOverhang(catPlan, cats.map((_, ci) => band.center(ci)), 4);
  if (catOverhang > 0) {
    plotX0 += catOverhang;
    plotW0 -= catOverhang;
    band = bandFor(plotX0, plotW0);
    catPlan = planRow(band, ticked);
  }
  return { band, catPlan };
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
export function columnPlotArea(
  domain: ColumnDomain,
  frame: FrameResult,
  warnings: LintWarning[],
): ColumnArea {
  const { options, theme, size, measure, variant, va, fmt, valueSpec, cats, dLo, dHi } = domain;
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
  // A total that misses a part carries "(partial)" on a second line.
  const partialH = (ci: number) => { const words = partialWords(domain, ci); return words ? measure(words, toDateFont(theme)).height : 0; };
  const hasCagr = (options.annotations ?? []).some((a) => a.kind === 'cagr');
  const integratedGrowthH = domain.pyRef && kindSetting(options, 'growth') !== false ? measure('+88.8%', strongFont).height + 4 : 0;
  // The rule sentence is engine-added furniture, so it computes its reserve
  // in the SAME decision that adds it instead of hunting for a free
  // slot later: an all-negative 60-column torture leaves no gap inside the
  // plot, and a corridor whose rule went missing is the silent lie this
  // preset exists to prevent. Wrapped against the frame width, which is
  // already known and does not depend on this reserve.
  const ruleOn = domain.anomaly !== undefined && kindSetting(options, 'valueLine') !== false;
  // The rule sentence AS RENDERED: it carries its own suppression trace.
  const ruleText = ruleOn ? `${domain.anomaly!.rule}${domain.corridorNote}` : '';
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
  const { band, catPlan } = columnBand(domain, frame, valueAxisReserve, tickFont, warnings, stair);
  const showCatRow = kindSetting(options, 'category') !== false && cats.length > 0 && !stair;
  if (showCatRow) pushAll(warnings, catPlan.warnings);
  if (showCatRow && catPlan.step === 'ranks') warnings.push(categoryRanksLint(cats.map((c) => c.label ?? c.id), band.step));
  const tickReserve = showCatRow ? catPlan.rowHeight + 8 : 0;
  // With a ratio tier the band additionally carries the tier's 19px caption
  // rhythm minus the tierGap the tier adds back below the band — the
  // same arithmetic as line's tier branch. The caption gap is a between-blocks
  // band owned by the tier, so the tick-band record reports only
  // `tickReserve`, the tick-row component.
  const catBandH = tier
    ? 6 + catPlan.rowHeight + ratioTierMetrics.categoryCaptionGap - theme.space.tierGap
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
  const unrowedH = frame.plot.h - catBandH - ratioTierHeight - 8 - axisTitleH - growthAndCagr - ruleH;
  const unrowedPlotH = unrowedH - hangingLabelReserve(unrowedH, [dLo, dHi], hangingEnd, hangingRoom);
  const totalsRow = !domain.gtContent ? 0 : domain.activeBreak ? gtH + 6
    : Math.max(0, maxOf(domain.posTopP.map((top, ci) => (top > 0 ? seatRoom(top, [dLo, dHi], gtH + partialH(ci) + 4, unrowedPlotH) : 0))));
  const headerRows = totalsRow + growthAndCagr;
  const axisTitleBand = valueAxisTitleBand(axisTitle, theme, measure, headerRows);
  const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
  const baseTopPad = 8 + axisTitleBand + headerRows + ruleH + (stair ? staircaseState(options).pad : 0);
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
  if (!stair && options.categoryLabels !== 'staircase' && ['fit', 'wrap', 'font-down', 'stride'].includes(catPlan.step)
    && !options.annotations?.some(annotation => annotation.kind === 'cagr' || annotation.kind === 'event')
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
      const height = maxOf(plots.flatMap(([a, b]) => [(PLOT_FLOOR_PX[options.target ?? DEFAULT_TARGET] - b) / a, -b / (a - plotFloorShare(size.width, options))]));
      const plotAtFloor = minOf(plots.map(([a, b]) => a * height + b));
      if (q >= 0 && q < 1 && Number.isFinite(height)
        && Math.min(...unrowed.map(([a, b]) => a * height + b)) >= 0) fixedPlotChrome(frame, height - plotAtFloor - chrome);
      else plotChromeFloor.delete(frame.frame);
    }
  }
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
    catPlan, showCatRow, tickReserve, catBandH: catBandH + hangingReserve,
    // The names may rise to the frame top, under the rule and the axis title.
    ...(stair ? { stairTop: frame.plot.y + ruleH + (axisTitle ? axisTitle.height + 8 : 0) } : {}),
    // A date row stays at the plot's bottom band; prose reads under the
    // lowest column and the value hanging under it.
    catRowY: catPlan.dateNumeric ? plot.y + plot.h + hangingReserve : categoryRowTop(y, lowest, hangingEnd, hangingRoom),
    plot, y, y0: y(0),
  };
}
