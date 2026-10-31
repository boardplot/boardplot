import { chartString, stringFields } from '../../strings';
import type { Theme } from '../../types/theme';
/**
 * Line phase 1, second half: what labels and annotations reserve
 * around the plot, the frame (the legend is a layout participant), the value
 * axis reserve and ticks, the ratio tier, the category row, and the plot rect
 * with its scales. The frame is solved here, before the scales, because the
 * plot rect comes out of it.
 */

import { BAND_PAD, GAP_BRACKET_RESERVE, VALUE_LINE_RESERVE } from '../../annotateParts';
import { AXIS_TITLE_GAP, measureValueAxisWidth, planValueAxisTitle, valueAxisTitleBand, valueAxisTitleText, valueAxisUnit, type ValueAxisTitle } from '../../axis';
import { dateTickRow, dayCategories } from '../../calendarLabels';
import type { DateTickInterval } from '../../dateFormat';
import { formatAutomaticPercent, notApplicableGlyph, numberRange } from '../../format';
import { percentCellsOnly } from '../../annotatePass';
import { frameTextOptions, normalizeLegendOption, plotHeightAfter, solveFrame, type FrameBand, type FrameInput, type FrameResult, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import { stepDownFont } from '../../label/rowFit';
import { planCategoryRow, rotatedLeftOverhang } from '../../label/categoryRow';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { PRIORITY } from '../../label/solver';
import { prepareRatioTier, ratioTierCanRender, ratioTierMetrics } from '../../ratioTier';
import { round2 } from '../../geometry';
import { linearScale, seatRoom } from '../../scale';
import type { FontSpec, TextMeasurer } from '../../text';
import { strokeToken, dashToken, canvasMargin, emphasisWeight, secondaryFont } from '../../theme';
import { X_PARTIAL_ROW, planXTicks, timeZoneNote, xTickRowPlan } from './xTicks';
import { NATURAL_BAND_STEP, plotFloorRows } from '../../sizing';
import type { Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { LegendOptions } from '../../types/options';
import type { LintWarning } from '../../types/scene';
import { BUMP_FOLDED, buildBumpStartLabels } from './bump';

/**
 * The category step a rank ladder keeps before its repeated start names give
 * way: half the natural step. A third would keep both name columns at 480 px
 * and leave the crossings 28 px apart; the compact form (rank numbers left,
 * names right) reads them 40 px apart.
 */
const BUMP_MIN_STEP = NATURAL_BAND_STEP / 2;
import { actualHeader, forecastBoundaries, forecastDividerAt, type ForecastBoundary } from './forecast';
import { lineFrameFootnotes } from './footnotes';
import { gapFillPaint } from './difference';
import { anomalyLegendItems, anomalyRuleLines, anomalyRuleReserve, columnCorridorPaint } from '../column/anomaly';
import { defaultValueContent, endUnitSuffix, fanEdgeInKey, flaggedPoints, lineFocusFont, lineToDateIds, PLOT_END_AIR, pointLabelEndRoom, pointLabelSelection, prepareEndpointLabels, usesEndLabelKey, valueUnit } from './labels';
import { forecastBoundaryX, latestRingReach } from './marks';
import { rangeRuns } from './range';
import { outerFanEdge } from './fan';
import { liveCategoryX } from './live';
import { lineTrendKeys } from './trend';
import { planReferenceBandColumn } from './referenceBands';
import type { LineArea, LineDomain, LineEnv, LinePaints, LineReserves, LineText } from './model';
import { categoryLabelsAndMarks, withCategoryNoteNames } from '../../footnoteMark';
import { partialAxisWords, saysToDate } from '../../partialPeriod';
import { textScaleOf } from '../../typeFloors';
import { footerType } from '../../footer';
import { DEFAULT_TARGET, targetFloorsPx } from '../../target';
import { disclosureNote, disclosuresShown } from '../../notes';
import { omittedKey } from '../../seriesIdentity';
import { maxOf, minOf, pushAll } from '../../arrays';

/**
 * RELATIVE quantization for receipt numbers whose scale is the author's, not
 * ours. `round2` is an ABSOLUTE 0.005 epsilon: it means one thing in euros and
 * another in thousands of euros, so a number quantized with it cannot be
 * compared, forked on, or trusted to still be non-zero. Significant digits
 * commute with a change of unit — sigRound(s·x) = s·sigRound(x) for any power
 * of ten — and never turn a non-zero difference into a zero, which is the
 * property the fan receipt needs. Ten digits is the float-noise line
 * (0.008000000000001023 → 0.008) and is five more than any author ever
 * supplies, so no digit that was actually authored is touched.
 */
export function sigRound(v: number | null, digits = 10): number | null {
  if (v === null || !Number.isFinite(v) || v === 0) return v;
  const m = Math.pow(10, digits - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * m) / m;
}

/**
 * Label and annotation reserves, known before the frame because a reserve may
 * only WIDEN the authored margin, never lose to it:
 * endpoint labels, the bump names at the first ranked category, and the
 * indicator100 gutters; and the room the end categories keep inside the plot.
 */
export function lineReserves(env: LineEnv, domain: LineDomain, paints: LinePaints, text: LineText, warnings: LintWarning[]): LineReserves {
  const { isBump, measure, size, highlights } = env;
  const { options, variant, isArea, drawnSeries, cats, pv, rowOf, rebased, absOf, labelModes } = domain;
  const { labelFont, labelH, composeText, printsZero } = text;
  const valueContent = text.contentOf('point', defaultValueContent(variant, labelModes.seriesValueContent)) ?? [];
  const keyValues = new Map<Id, string>();
  if (usesEndLabelKey(options) && labelModes.values !== 'none' && valueContent.length > 0) {
    for (const s of drawnSeries) {
      const ci = domain.lastIdxOf.get(s.id);
      if (ci === undefined) continue;
      const cell = s.vals[ci]!;
      // Authored endpoint text stays at its point or in its omission note, never in a second key copy.
      if (cell.labelOverride !== undefined) continue;
      const value = rebased ? pv[rowOf.get(s)!]![ci]! : absOf(s, ci);
      const source = rebased ? undefined : cell.format ? { ...s, format: cell.format } : s;
      let printed = text.composeEndText(valueContent, value, variant === 'stacked100-area' && !domain.sharesWithheld.has(cats[ci]!.id) ? domain.labelPv[rowOf.get(s)!]![ci]! : null,
        cats[ci]!.label ?? cats[ci]!.id, '', endUnitSuffix(options, rebased), cell.isPct, source, cats[ci]!.id);
      if (domain.x?.range && isArea && labelModes.values === 'ends') {
        const first = pv[rowOf.get(s)!]!.findIndex(value => value !== null);
        if (first >= 0 && first !== ci && s.vals[first]!.labelOverride === undefined) {
          const firstCell = s.vals[first]!;
          const firstSource = rebased ? undefined : firstCell.format ? { ...s, format: firstCell.format } : s;
          const start = text.composeEndText(valueContent, rebased ? pv[rowOf.get(s)!]![first]! : absOf(s, first),
            variant === 'stacked100-area' && !domain.sharesWithheld.has(cats[first]!.id) ? domain.labelPv[rowOf.get(s)!]![first]! : null,
            cats[first]!.label ?? cats[first]!.id, '', endUnitSuffix(options, rebased), firstCell.isPct, firstSource, cats[first]!.id);
          if (start) printed = printed ? `${start} → ${printed}` : start;
        }
      }
      // A time axis has no category name to carry a running end period's words, so the key value does.
      const words = options.strings?.toDate ?? chartString(options, 'toDate');
      if (printed) keyValues.set(s.id, domain.x && cats[ci]!.partial === true && !saysToDate(cats[ci]!.label ?? cats[ci]!.id, words) ? `${printed} ${words}` : printed);
    }
  }
  // Before the names: the name column starts clear of the last values. A
  // value the near-zero group withholds is still counted, which only adds air.
  const categoryEndRoom = pointLabelEndRoom({ valueLabels: labelModes.values, valueLabelsAuthored: options.valueLabels !== undefined, labelOnly: domain.labelOnly, lastWithheld: new Set(), valueContent, variant,
    contentOf: text.contentOf, drawnSeries, pv, rowOf, cats, rebased, composeText, composeEndText: text.composeEndText, absOf, measure, labelFont, highlights,
    sharesWithheld: domain.sharesWithheld, ...valueUnit(options, isBump, rebased), isStacked: domain.isStacked, flagged: flaggedPoints(domain),
    ...(domain.x ? { endToDate: { ids: lineToDateIds(env, domain, text), words: options.strings?.toDate ?? chartString(options, 'toDate'), theme: env.theme, measure } } : {}) });
  // Area labels fit inside their bands; their width does not inset the data.
  if (isArea) categoryEndRoom.left = categoryEndRoom.right = 0;
  // The latest-point ring's paint keeps the same air to the plot's end.
  if (options.latestPoint !== undefined && options.latestPoint !== 'none') {
    categoryEndRoom.right = Math.max(categoryEndRoom.right, latestRingReach(env.theme) + PLOT_END_AIR);
  }
  // A cut range maps to the plot edges, including the snapped edges of zoom buckets.
  if (domain.x) {
    if (domain.x.shown[0]! > domain.x.lo) categoryEndRoom.left = 0;
    if (domain.x.shown[domain.x.shown.length - 1]! < domain.x.hi) categoryEndRoom.right = 0;
  }
  const bumpFolded = (options as { [BUMP_FOLDED]?: ReadonlyMap<string, string> })[BUMP_FOLDED];
  const endpointInput: Parameters<typeof prepareEndpointLabels>[0] = {
    options, names: labelModes.series, valueContent, endRoom: categoryEndRoom.right, labelOnly: domain.labelOnly, variant, isBump, isArea, drawnSeries, cats,
    mergeEndValues: labelModes.values !== 'none' && text.contentOf('point', ['absolute']) !== null,
    lastIdxOf: domain.lastIdxOf, pv: domain.labelPv, rowOf, rebased, absOf, composeText: text.composeEndText, printsZero,
    // The endpoint swatch tells lines apart; a lone fan centre needs none.
    heroMode: paints.heroMode && drawnSeries.length >= 2,
    anyHighlight: env.anyHighlight, size, labelFont: text.nameFont, labelH, measure, sharesWithheld: domain.sharesWithheld,
    // each name column keeps 8px to the canvas and 6px to its rank tick or line end.
    ...(isBump ? { bumpNameRoom: size.width - cats.length * NATURAL_BAND_STEP - measureValueAxisWidth([1, domain.bumpLadderMax], String, env.theme, measure, 5, undefined, [1, domain.bumpLadderMax]) - 2 * 14 } : {}),
    ...(bumpFolded ? { bumpFolded } : {}),
    // The story names print bold (assembleLineGeometry).
    // A grey-highlighted line chart names its focus series bold too.
    ...((isBump && env.anyHighlight && options.highlightMode !== 'fade') || lineFocusFont(env, domain, text.nameFont, 0)
      ? { bumpStory: { ids: env.highlights, font: { ...text.nameFont, weight: emphasisWeight(env.theme) } } } : {}),
  };
  let endpoint = prepareEndpointLabels(endpointInput);
  // A rank chart is read from both ends, so bump names the FIRST ranked category too.
  const built = buildBumpStartLabels({
    // A focused bump names only the lines it draws; the note names the rest.
    isBump, endContent: endpoint.endContent, dataSeries: domain.drawnSeries, pv, rowOf, cats, composeText, nameBlock: endpoint.nameBlock,
    ...(bumpFolded ? { folded: bumpFolded } : {}),
  });
  // Where two name columns leave the plot a category step under BUMP_MIN_STEP,
  // the start names that repeat an end name give way; an entrant's start name stays.
  const bumpAxisW = isBump ? measureValueAxisWidth([1, domain.bumpLadderMax], String, env.theme, measure, 5, undefined, [1, domain.bumpLadderMax]) : 0;
  const bumpStep = (size.width - built.startReserve - startColumnInset(options.margin?.left ?? canvasMargin(env.theme, size.width).left) - endpoint.endReserve - bumpAxisW - 2 * 14) / Math.max(1, cats.length - 1);
  const shortOfRoom = built.startReserve > 0 && bumpStep < BUMP_MIN_STEP;
  const startLabels = shortOfRoom ? built.startLabels.filter((label) => label.ci > 0) : built.startLabels;
  const startReserve = shortOfRoom ? 0 : built.startReserve;
  if (shortOfRoom) endpoint = prepareEndpointLabels({ ...endpointInput, bumpOneColumn: true });
  let annList: Annotation[] = options.annotations ?? [];
  if (isBump) {
    // note/callout/event are about the PERIOD or the exhibit and survive the
    // change of quantity. The rest are arithmetic on values: a CAGR of a rank
    // is meaningless, indicator100 has no basis, and valueLine/band would draw
    // a value level on a rank ladder.
    const supported = new Set(['note', 'callout', 'event']);
    const dropped = annList.filter((a) => !supported.has(a.kind));
    if (dropped.length > 0) {
      warnings.push({
        code: 'bump-annotation-unsupported',
        severity: 'warn',
        message: `annotation kind${dropped.length === 1 ? '' : 's'} ${[...new Set(dropped.map((a) => `'${a.kind}'`))].join(', ')} compute on values and have no meaning on a rank axis — dropped; 'note', 'callout' and 'event' are supported`,
      });
      annList = annList.filter((a) => supported.has(a.kind));
    }
  }
  // a shown value axis already ticks "100%" at exactly the indicator's spot —
  // the duplicate would only collide with it and hide. Engine furniture, not
  // authored content: the sentinel id marks it (bar parity), and endpoint-band
  // priority keeps a squeezed '100%' at info severity while still surviving
  // density='minimal'.
  // The value scale is on by default where not every point prints.
  const axisShown = options.valueAxis?.show ?? labelModes.values !== 'all';
  if (variant === 'stacked100-area' && text.kindSetting('percentIndicator') !== false && !axisShown && !annList.some((a) => a.kind === 'indicator100')) {
    annList = [...annList, { kind: 'indicator100', side: 'left', id: 'indicator100-auto', priority: PRIORITY.endpoint }];
  }
  // indicator100 text sits outside the plot: tick at ±6, text 8px beyond it
  // (annotate.ts geometry), so the gutter needs text width + 14, +2 breathing.
  const indicatorW = measure('100%', text.tickFont).width + 16;
  const lastId = cats[cats.length - 1]?.id;
  return {
    endpoint,
    keyValues,
    categoryEndRoom,
    startLabels,
    startReserve,
    annList,
    namesAtPlotEdge: isBump || domain.x?.range?.cut.hi === true || annList.some((a) => a.kind === 'band' && (a.divider === 'end' || a.divider === 'both') && a.to === lastId),
    indicatorLeftReserve: annList.some((a) => a.kind === 'indicator100' && (a.side ?? 'left') === 'left') ? indicatorW : 0,
    indicatorRightReserve: annList.some((a) => a.kind === 'indicator100' && a.side === 'right') ? indicatorW : 0,
    referenceBands: planReferenceBandColumn(options.referenceBands, size.width, text.tickFont, measure),
  };
}

/** At or below this canvas width the end-label fallback key is a row above the plot, never beside it. */
const SIDE_KEY_MIN_WIDTH = 480;
/** The air a value inside a sloped top band needs over its own height (an estimate). */
const THIN_TOP_AIR = 6;

/**
 * The legend. A fan turns it on when the author said nothing: washes are an
 * encoding with no other explanation on the page, and the DEFAULT is what an
 * agent gets first.
 */
function lineLegend(theme: Theme, domain: LineDomain, paints: LinePaints, _text: LineText, reserves: LineReserves, warnings: LintWarning[], width: number): FrameInput['legend'] {
  const { options, labelModes, refSeries, drawnSeries, fan, isArea } = domain;
  const { fanPaints, fanLadder } = paints;
  const legendPosition = typeof options.legend === 'object' ? options.legend.position : options.legend;
  const boundedKey = usesEndLabelKey(options);
  // The anomaly marker and corridor are encodings with no other key, as on column.
  const anomalyKeys = domain.anomaly
    ? anomalyLegendItems(theme, domain.anomaly.model, domain.anomaly.corridorShown, domain.anomaly.statFmt, columnCorridorPaint(options.colorblindSafe), options.strings, options.locale?.language)
    : [];
  // seriesLabels 'key', or the fallback for unnamed series, draws the key
  // row unless the author placed the legend; the explicit 'key' outranks a
  // legend 'none'.
  // A gap fill between two lines names its tones in the key,
  // one entry per side the data reaches ("Cost above Budget").
  // A neutral wash between two lines that are named where they are drawn
  // explains itself: it needs no key row of its own.
  const gapSeries = options.gapFill?.between ?? [];
  const gapNamed = (labelModes.series === 'end' || labelModes.series === 'inline') && !boundedKey && !reserves.endpoint.endpointLegendFallback &&
    gapSeries.every((id) => labelModes.only === undefined || labelModes.only.has(id)) &&
    (options.gapFill?.positiveTone ?? 'good') === 'neutral' && (options.gapFill?.negativeTone ?? 'bad') === 'neutral';
  const gapKeys = gapNamed ? [] : gapFillLegendItems(domain);
  const trendKeys = lineTrendKeys(theme, domain, paints);
  // A series rebase100 could not index draws nothing; when its disclosure does not print, the key names it and why.
  const droppedKeys: LegendItemInput[] = disclosuresShown(options) && !domain.rebaseCompact ? [] : domain.rebaseSuppressed.map((s) =>
    omittedKey(s.id, stringFields(s.zero ? options.strings!.rebaseZero! : options.strings!.rebaseMissing!, { series: s.series, period: s.period })));
  const narrow = width <= SIDE_KEY_MIN_WIDTH;
  // Overriding legend: 'none' (legend-none-overridden) the key goes into a row: a side key would starve the plot again.
  const legendOption = boundedKey ? narrow || legendPosition === 'none' || domain.x?.range && (isArea || fan) ? 'top' as const : 'right' as const : reserves.endpoint.endpointLegendFallback
    ? legendPosition === 'top' || legendPosition === 'bottom' ? legendPosition : ('top' as const)
    : labelModes.series === 'key' && (legendPosition === undefined || legendPosition === 'none')
      ? ('top' as const)
      : options.legend ?? (fanPaints || anomalyKeys.length > 0 || gapKeys.length > 0 || trendKeys.length > 0 || (droppedKeys.length > 0 && !domain.rebaseCompact) ? ('top' as const) : undefined);
  if (trendKeys.length > 0 && (legendPosition === 'none' || legendPosition === 'auto')) warnings.push({
    code: 'legend-suppressed-encoding', severity: 'warn', field: ['options', 'legend'],
    message: 'the legend hides the trend names, slopes and r²; set legend to top, bottom or right',
  });
  if (anomalyKeys.length > 0 && legendOption === 'none') {
    warnings.push({
      code: 'legend-suppressed-encoding',
      severity: 'warn',
      message: "legend: 'none' suppressed the only key naming this exhibit's encodings (the anomaly corridor and flag marker) — the reader is left to infer them",
      suggest: "drop legend: 'none', or drop anomaly",
    });
  }
  if (fanPaints && (legendOption === undefined || legendOption === 'none')) {
    const n = fan!.bands.length;
    warnings.push({
      code: 'fan-legend-suppressed',
      severity: 'warn',
      message: `legend 'none' leaves ${n} uncertainty band${n === 1 ? '' : 's'} on the page with nothing saying what ${n === 1 ? 'it means' : 'they mean'} — '${fan!.bands.map((b) => b.label).join("', '")}' are drawn identically to any other interval`,
      suggest: "set legend to 'top' (the default when a fan is present), or remove options.fan",
    });
  }
  if (!legendOption || legendOption === 'none' || legendOption === 'auto') return undefined;
  const legendOpts: LegendOptions = normalizeLegendOption(legendOption);
  let items: LegendItemInput[] = [
    ...drawnSeries.flatMap((s, i): LegendItemInput[] => {
      const dropped = droppedKeys.find((item) => item.id === s.id);
      if (dropped) return [dropped];
      const row = domain.pv[domain.rowOf.get(s)!]!;
      const points = row.flatMap((v, ci) => v === null ? [] : [ci]);
      const hasPath = points.some((ci, j) => j > 0 && (s.interpolateGaps || ci === points[j - 1]! + 1))
        || domain.x?.range && rangeRuns(domain.x.range, [domain.x.range.plotted[domain.rowOf.get(s)!]!], domain.interpolationFor(s), s.interpolateGaps).some(run => run[0]!.points.length >= 2);
      if (!hasPath && !(isArea && domain.isStacked)) {
        const ci = points.find(ci => paints.markerOf(s, i, ci) !== 'none');
        if (ci === undefined) return []; // No path and no marker: no ink for a key to explain.
        const shape = paints.markerOf(s, i, ci);
        const paint = paints.series(s, i);
        const hollow = paints.hollowAt(s, ci);
        return [{ id: s.id, label: s.label, paint: hollow ? { token: 'background' } : paint,
          ...(hollow ? { stroke: paint } : {}), key: shape === 'square' ? 'box' : shape === 'triangle' || shape === 'diamond' ? shape : 'marker' }];
      }
      // A line that draws markers at its full points keys one at its centre, hollow when they all are.
      const full = isArea ? [] : points.filter((ci) => domain.cats[ci]!.partial !== true && paints.markerOf(s, i, ci) !== 'none');
      const shape = full.length > 0 ? paints.markerOf(s, i, full[0]!) : 'none';
      return [{ id: s.id, label: s.label, paint: paints.keyPaint(s, i),
        key: isArea ? 'box' : 'line',
        ...(!isArea ? { width: paints.lineWidthOf(s) } : {}),
        ...(shape !== 'none' ? { marker: { shape, ...(full.every((ci) => paints.hollowAt(s, ci)) ? { hollow: true } : {}) } } : {}),
        ...(paints.lineHollowOf(s) ? { hollow: true, width: paints.lineWidthOf(s) } : {}),
        ...(!isArea && paints.legendDashOf(s, i) ? { dash: paints.legendDashOf(s, i), lineCap: paints.legendDashOf(s, i)?.join(',') === dashToken(theme, 'dotted').join(',') ? 'round' as const : 'butt' as const } : {}) }];
    }),
    ...refSeries.map((s) => ({ id: s.id, label: s.label, paint: paints.ref(s), key: 'line' as const, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'reference') })),
    // Band keys after the data series, outermost first, only for bands that
    // paint. The ladder is measured for a WASH; at 9x9px adjacent rungs read as
    // one smudge, so each chip gets an edge in the centre's own ink.
    ...(fanPaints
      ? fan!.bands.map((band, bi) => ({ id: `fan:${bi}`, label: band.label, paint: fanLadder[bi]!.paint, key: 'box' as const, stroke: paints.fanCentrePaint! }))
      : []),
    // ONE key for the bound hairlines, not 2n: every hairline means the same
    // thing, "a bound the author stated".
    ...(fanPaints && fan!.showBounds
      ? [{ id: 'fan:bounds', label: options.strings!.declaredBounds!, paint: fanLadder[fan!.bands.length]!.paint, key: 'line' as const, width: strokeToken(theme, 'rule'), dash: dashToken(theme, 'dotted'), lineCap: 'round' as const }]
      : []),
    ...anomalyKeys,
    ...gapKeys,
    ...trendKeys,
    ...droppedKeys.filter((item) => !drawnSeries.some((s) => s.id === item.id)),
  ];
  if (boundedKey) {
    // The outer band names the interval at its last reading, as its edge values would on the chart.
    const fanEdge = fanEdgeInKey(domain) && fanPaints ? outerFanEdge(domain, fan!.bands.map(band => ({ low: band.low.id, high: band.high.id }))) : undefined;
    // { only } gives the other series no name and no value; the fallback key keeps that.
    items = items.filter(item => !labelModes.only || labelModes.only.has(item.id) || !drawnSeries.some(s => s.id === item.id)).map(item => {
      if (fanEdge && item.id === `fan:${fanEdge.index}`) {
        const category = domain.cats[fanEdge.ci]!.label ?? domain.cats[fanEdge.ci]!.id;
        return { ...item, label: `${item.label}${fanEdge.ci < domain.cats.length - 1 ? ` (${category})` : ''} ${numberRange(domain.fmt(fanEdge.low), domain.fmt(fanEdge.high))}` };
      }
      const s = drawnSeries.find(s => s.id === item.id);
      const ci = s && domain.lastIdxOf.get(s.id);
      if (!s || ci === undefined || !reserves.keyValues.has(s.id)) return item;
      const content = _text.contentOf('point', defaultValueContent(domain.variant, domain.labelModes.seriesValueContent)) ?? [];
      const category = domain.cats[ci]!.label ?? domain.cats[ci]!.id;
      const printed = reserves.keyValues.get(s.id)!;
      return { ...item, label: `${item.label}${ci < domain.cats.length - 1 && !content.includes('category') ? ` (${category})` : ''}${printed ? ` ${printed}` : ''}` };
    }).sort((a, b) => (domain.endpoints[b.id]?.value ?? -Infinity) - (domain.endpoints[a.id]?.value ?? -Infinity));
  }
  if (legendOpts.order && !boundedKey) {
    const oi = (id: Id) => {
      const k = legendOpts.order!.indexOf(id);
      return k === -1 ? Number.MAX_SAFE_INTEGER : k;
    };
    items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
  }
  // Default end names replace repeated keys. An authored legend keeps every requested entry.
  if (options.legend === undefined && !domain.bumpDerived && labelModes.series === 'end' && !boundedKey) {
    const named = new Set(reserves.endpoint.endLabels.filter(label => !label.shared).map(label => label.s.id));
    items = items.filter(item => !named.has(item.id));
  }
  return items.length > 0 ? { options: legendOpts, items } : undefined;
}

/** The key entries of options.gapFill: the tone each side paints, where the data reaches it. */
function gapFillLegendItems(domain: LineDomain): LegendItemInput[] {
  const spec = domain.options.gapFill;
  if (!spec) return [];
  const a = domain.drawnSeries.find((series) => series.id === spec.between[0]);
  const b = domain.drawnSeries.find((series) => series.id === spec.between[1]);
  if (!a || !b) return [];
  const rowA = domain.pv[domain.rowOf.get(a)!]!;
  const rowB = domain.pv[domain.rowOf.get(b)!]!;
  const sides = new Set(domain.cats.flatMap((_, ci) => {
    const [va, vb] = [rowA[ci], rowB[ci]];
    return va === null || va === undefined || vb === null || vb === undefined || va === vb ? [] : [va > vb ? 'positive' : 'negative'];
  }));
  const toneOf = (side: 'positive' | 'negative') => (side === 'positive' ? spec.positiveTone ?? 'good' : spec.negativeTone ?? 'bad');
  // Both sides in one tone paint one colour: one entry says what it spans.
  if (sides.size === 2 && toneOf('positive') === toneOf('negative')) {
    const tone = toneOf('positive');
    return [{ id: 'gap', label: stringFields(domain.options.strings!.gapBetween!, { first: a.label, second: b.label }), paint: gapFillPaint(tone) as LegendItemInput['paint'], key: 'box' as const }];
  }
  return (['positive', 'negative'] as const).filter((side) => sides.has(side)).map((side) => {
    const tone = toneOf(side);
    return {
      id: `gap:${side}`,
      label: stringFields(side === 'positive' ? domain.options.strings!.aboveSeries! : domain.options.strings!.belowSeries!, { first: a.label, second: b.label }),
      // The same paint the gap region draws with (difference.ts addGapRegion).
      paint: gapFillPaint(tone) as LegendItemInput['paint'],
      key: 'box' as const,
    };
  });
}

/** The room a start name column adds past its 8 px to the canvas edge, to start at the frame inset. */
const startColumnInset = (frameLeft: number): number => Math.max(0, frameLeft - 8);

/**
 * The frame. Authored margin is a MINIMUM inset: label reserves may only widen
 * it, never lose to it. The left widening reaches the frame as `plotInset`, not
 * as `margin.left`: the reserve belongs to the PLOT, and folding it into the
 * margin would anchor the title to the plot instead of the canvas. The token
 * margin is the base.
 */
export function solveLineFrame(
  env: LineEnv,
  domain: LineDomain,
  paints: LinePaints,
  text: LineText,
  reserves: LineReserves,
  warnings: LintWarning[],
  eventKey?: FrameBand,
): { frame: FrameResult; claims: OccupiedIndex; margin: LineArea['margin']; leftMargin: number } {
  const { theme, size, isBump, measure } = env;
  const { options, cats, seriesNorm } = domain;
  const frameOptions = withCategoryNoteNames(options, cats);
  const tokenMargin = canvasMargin(theme, size.width);
  const authoredLeft = options.margin?.left ?? tokenMargin.left;
  // The start name column begins at the frame inset, where the title starts, not 8 px from the canvas edge (8 px stays the least).
  const leftMargin = Math.max(authoredLeft, reserves.indicatorLeftReserve, reserves.startReserve > 0 ? reserves.startReserve + startColumnInset(authoredLeft) : 0);
  const margin = {
    top: tokenMargin.top,
    bottom: ratioTierCanRender(options.ratioTier, cats, seriesNorm) ? 3 : tokenMargin.bottom,
    ...options.margin,
    left: authoredLeft,
    right: ((options as { [GAP_BRACKET_RESERVE]?: number })[GAP_BRACKET_RESERVE] ?? 0) + Math.max(options.margin?.right ?? tokenMargin.right, reserves.endpoint.endReserve, reserves.indicatorRightReserve, reserves.referenceBands?.reserve ?? 0,
      (options as { [VALUE_LINE_RESERVE]?: number })[VALUE_LINE_RESERVE] ?? 0,
      // The anomaly rules carry their numbers right of the plot, as on column.
      domain.anomaly
        ? anomalyRuleReserve(anomalyRuleLines(theme, domain.anomaly.model, domain.anomaly.corridorShown, domain.anomaly.statFmt, { token: 'warn' }, options.strings), text.labelFont, measure)
        : 0),
  };
  const legend = lineLegend(theme, domain, paints, text, reserves, warnings, size.width);
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame(
    {
      size,
      margin,
      plotInset: { left: leftMargin - authoredLeft },
      ...frameTextOptions(frameOptions),
      // Actually ignored, not merely warned about: `bump-unit-ignored` would
      // be a lie if the frame still printed "in EUR m" over a rank ladder.
      unit: isBump ? undefined : options.unit,
      footnotes: [
        ...lineFrameFootnotes({ fan: domain.fan, cats, partialNamed: lineToDateIds(env, domain, text).size > 0, bumpDerived: domain.bumpDerived, nearZeroTail: reserves.endpoint.nearZeroTail, options: frameOptions,
          footer: { width: size.width - margin.left - margin.right, font: { family: theme.type.family, ...footerType(theme.type.footnote, options.target, textScaleOf(options)) }, measure },
          mixedSign: cats.filter((c) => domain.nmCats100.has(c.id) && !domain.overfullCats100.has(c.id)), incompleteStack: domain.incompleteStack,
          knownParts: cats.filter(c => domain.sharesWithheld.has(c.id)), rebaseSuppressed: domain.rebaseCompact ? [] : domain.rebaseSuppressed, bumpOmitted: domain.bumpOmitted }),
        ...domain.shareNotes,
        // The anomaly rule, stated on the exhibit (column prints it over the plot).
        ...(domain.anomaly ? [disclosureNote(`${domain.anomaly.model.rule}${domain.anomaly.corridorNote}`)] : []),
        ...timeZoneNote(domain, options),
      ],
      legend,
      ...(eventKey ? { eventKey } : {}),
      theme,
      measure,
    },
    claims,
  );
  return { frame, claims, margin, leftMargin };
}

/**
 * Value-axis ticks and reserve. The axis shows on bump (without rank ticks the
 * reader cannot tell rank 3 from rank 7) or when asked; a line whose domain
 * does not start at zero, or an authored value line past the data, discloses
 * its tick even with the axis off. Ticks raster over the TICK SET, not the
 * data.
 */
function valueAxisTicks(env: LineEnv, domain: LineDomain, frame: FrameResult) {
  const { theme, measure, isBump } = env;
  const { options, variant, dLo, dHi, bumpDerived } = domain;
  const va = options.valueAxis ?? {};
  const baselineTolerance = Math.max(1, Math.abs(dHi - dLo)) * 1e-12;
  const discloseNonzeroBaseline = !isBump && variant === 'line' && dLo > baselineTolerance;
  // Where not every point prints its value, a value scale
  // reads the rest, unless the author turns it off.
  const axisShown = bumpDerived ? true : va.show ?? domain.labelModes.values !== 'all';
  // Percent cells print '%' on the ticks as on the point labels (fmtPercent).
  const percentAxis = !bumpDerived && variant !== 'stacked100-area' && !domain.rebased && percentCellsOnly(domain.dataSeries);
  const axisFmt = bumpDerived
    ? (v: number): string => String(Math.round(v))
    : variant === 'stacked100-area'
      ? (v: number) => formatAutomaticPercent(v, 0, false, options.locale?.language)
      : percentAxis ? domain.valueSpec.fmtPercent : domain.fmt;
  const axisTickSpec = bumpDerived || variant === 'stacked100-area' ? undefined : percentAxis ? domain.valueSpec.percentSpec : domain.valueSpec.spec;
  let bumpTicks: number[] | undefined;
  if (bumpDerived) {
    const max = domain.bumpLadderMax;
    const stride = max > 25 ? 5 : max > 12 ? 2 : 1;
    bumpTicks = [];
    for (let rank = 1; rank <= max; rank += stride) bumpTicks.push(rank);
    if (bumpTicks[bumpTicks.length - 1] !== max) bumpTicks.push(max);
  }
  const baselineValue = sigRound(va.reverse ? dHi : dLo)!;
  const valueLineTicks = domain.domainExtendingValueLines
    .map(({ value }) => sigRound(value))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  let disclosedTicks: number[] | undefined;
  const stepTicks = axisShown && !bumpDerived ? domain.stepTicks : undefined;
  if (!bumpDerived && (discloseNonzeroBaseline || valueLineTicks.length > 0)) {
    const ticks = axisShown ? [...(stepTicks ?? linearScale([dLo, dHi], [0, 1]).ticks(5))] : [];
    const addTick = (value: number): void => {
      const tolerance = Math.max(1, Math.abs(value)) * 1e-12;
      if (!ticks.some((tick) => Math.abs(tick - value) <= tolerance)) ticks.push(value);
    };
    if (discloseNonzeroBaseline) addTick(baselineValue);
    for (const value of valueLineTicks) addTick(value);
    disclosedTicks = ticks.sort((left, right) => left - right);
  }
  const fullValueAxisReserve = axisShown
    ? bumpTicks
      ? measureValueAxisWidth([bumpTicks[0]!, bumpTicks[bumpTicks.length - 1]!], axisFmt, theme, measure)
      : measureValueAxisWidth([dLo, dHi], axisFmt, theme, measure, 5, axisTickSpec, disclosedTicks ?? stepTicks)
    : 0;
  const disclosureReserve = !axisShown && disclosedTicks
    ? Math.max(0, measureValueAxisWidth([dLo, dHi], axisFmt, theme, measure, 5, axisTickSpec, disclosedTicks) - frame.plot.x)
    : 0;
  return {
    axisShown, axisFmt, axisTickSpec, bumpTicks, disclosedTicks, stepTicks, discloseNonzeroBaseline, baselineValue,
    valueAxisReserve: Math.max(fullValueAxisReserve, disclosureReserve),
  };
}

/**
 * The category row. dateTicks puts one tick per calendar interval, or refuses
 * precisely: the interval only decides WHICH categories carry a label, and a
 * category without an ISO date refuses the combination instead of guessing an
 * interval from "Q1".
 */
function categoryRow(env: LineEnv, domain: LineDomain, text: LineText, reserves: LineReserves, frame: FrameResult, valueAxisReserve: number, warnings: LintWarning[]) {
  if (domain.x) return continuousRow(env, domain, domain.x, text, reserves, frame, valueAxisReserve, warnings);
  const { theme, measure } = env;
  const { options, cats, population } = domain;
  const n = cats.length;
  const warningsBefore = warnings.length;
  // A sparse composition has isolated bands, not a filled span between categories.
  const sparseComposition = domain.variant === 'stacked100-area' && n <= 3 && !cats.some((_, ci) =>
    ci > 0 && !domain.compositionInvalidAt(ci - 1) && !domain.compositionInvalidAt(ci));
  // Filled areas use plot edges; a short composition without a span keeps band centres.
  const crossesBetween = options.categoryAxis?.crossesBetween ?? (!domain.isArea || sparseComposition);
  let categoryPlotX = frame.plot.x + valueAxisReserve;
  let categoryPlotWidth = Math.max(10, frame.plot.w - valueAxisReserve);
  const grid = population ?? domain.timeline;
  const spanOf = (x0: number, width: number) => categorySpan({ x: x0, w: width }, grid?.span ?? n, crossesBetween, reserves.categoryEndRoom);
  // On a proportional time axis the shortest gap is the step labels must fit.
  const categoryStepFor = (x0: number, width: number) => categoryStep(spanOf(x0, width).w, population ? n : grid?.span ?? n, crossesBetween);
  const categoryCentersFor = (x0: number, width: number) =>
    cats.map((_, ci) => liveCategoryX(ci, n, crossesBetween, spanOf(x0, width), grid));
  const dateTicks = options.categoryAxis?.dateTicks as DateTickInterval | undefined;
  const ticked = dateTicks ? dateTickRow(cats, dateTicks, options.locale?.language, options.locale?.weekStartsOn) : undefined;
  if (dateTicks && ticked!.ticks === null) {
    warnings.push({
      code: 'date-ticks-unsupported',
      severity: 'info',
      message: `categoryAxis.dateTicks '${dateTicks}' was ignored: not every category carries an ISO date, so no calendar interval can be resolved`,
      suggest: "give each category an ISO 'date' or drop categoryAxis.dateTicks",
    });
  } else if (dateTicks && dateTicks !== 'weeks' && options.locale?.weekStartsOn !== undefined) {
    warnings.push({
      code: 'week-start-ignored',
      severity: 'info',
      message: `locale.weekStartsOn was ignored: a week boundary only decides something for dateTicks 'weeks', and the requested interval is '${dateTicks}'`,
      suggest: "set categoryAxis.dateTicks to 'weeks' or drop locale.weekStartsOn",
    });
  }
  // Line keys no running period, so its name says so where the note does not print.
  const row = categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings }, partialAxisWords(options.strings, options, lineToDateIds(env, domain, text).size > 0));
  ticked?.name(row);
  const planWith = (x0: number, width: number, fonts: typeof text.tickFont[]) =>
    planCategoryRow({
      target: options.target, textScale: textScaleOf(options),
      ...row,
      ordered: true,
      strideFromEnd: true,
      centers: categoryCentersFor(x0, width),
      step: categoryStepFor(x0, width),
      fonts,
      secondary: secondaryFont(theme), periods: cats.length > 0 && cats.every(c => c.date !== undefined),
      measure,
      plotHeight: frame.plot.h,
      reference: { x: frame.plot.x, width: frame.plot.w },
      ...ticked?.plan,
      ...(!crossesBetween && !domain.isArea ? { edgeAnchored: true } : {}),
    });
  const planRow = (x0: number, width: number) => {
    const down = stepDownFont(theme, text.tickFont, 'axis', options.target, textScaleOf(options)) ??
      { ...text.tickFont, size: targetFloorsPx(options.target ?? DEFAULT_TARGET, textScaleOf(options)).axis };
    const plan = planWith(x0, width, [text.tickFont, down]);
    if (plan.maxLines <= 2 || plan.rotation !== 0) return plan;
    // A name that needs three lines steps down to the 9 px
    // floor on two instead, where every name then fits whole.
    const floor = stepDownFont(theme, text.tickFont, 'axis', options.target, textScaleOf(options)) ?? text.tickFont;
    const stepped = planWith(x0, width, [floor]);
    return stepped.maxLines <= 2 && stepped.step !== 'stride' && !stepped.infos.some((info) => info.truncated) ? stepped : plan;
  };
  let catPlan = planRow(categoryPlotX, categoryPlotWidth);
  // A default day row that steps past four weeks prints day numbers that drift
  // from month to month ("3 2 1 31 30"); the month calendar names that span instead.
  const dated = dateTicks || catPlan.stride <= 28 ? undefined : dayCategories(cats);
  if (dated) {
    warnings.length = warningsBefore;
    const months = { ...options, categoryAxis: { ...options.categoryAxis, dateTicks: 'months' as const } };
    return categoryRow(env, { ...domain, cats: dated, options: months }, text, reserves, frame, valueAxisReserve, warnings);
  }
  let categoryOverhang = rotatedLeftOverhang(catPlan, categoryCentersFor(categoryPlotX, categoryPlotWidth), 4);
  let categoryRightOverhang = 0;
  if (categoryOverhang > 0) {
    categoryPlotX += categoryOverhang;
    categoryPlotWidth -= categoryOverhang;
    catPlan = planRow(categoryPlotX, categoryPlotWidth);
  }
  if (domain.isArea && !crossesBetween && catPlan.rotation === 0) {
    // Reserve space outside the plot for half of each edge label. The
    // data still end on the plot edges, and centred labels stay on canvas.
    for (let pass = 0; pass < 3 && n > 0; pass++) {
      const left = Math.max(0, catPlan.infos[0]!.w / 2 + 2 - categoryPlotX);
      const right = Math.max(0, catPlan.infos[n - 1]!.w / 2 + 2 - (env.size.width - categoryPlotX - categoryPlotWidth));
      if (left + right < 0.01) break;
      categoryOverhang += left;
      categoryRightOverhang += right;
      categoryPlotX += left;
      categoryPlotWidth = Math.max(10, categoryPlotWidth - left - right);
      catPlan = planRow(categoryPlotX, categoryPlotWidth);
    }
    // Keep edge ticks centred on their points, including a thinned row.
    const centers = categoryCentersFor(categoryPlotX, categoryPlotWidth);
    const infos = catPlan.infos;
    catPlan = { ...catPlan, x: ci => centers[ci]! - infos[ci]!.w / 2,
      anchor: (ci, width) => centers[ci]! - width / 2 };
  }
  return { catPlan, categoryOverhang, categoryRightOverhang, crossesBetween, intervalTicks: ticked?.ticks ?? undefined };
}

/**
 * The tick row of a continuous axis (xTicks.ts), planned on the span the
 * readings take: the axis range runs from plot edge to plot edge.
 */
function continuousRow(env: LineEnv, domain: LineDomain, x: NonNullable<LineDomain['x']>, text: LineText, reserves: LineReserves, frame: FrameResult, valueAxisReserve: number, warnings: LintWarning[]) {
  const plotX = frame.plot.x + valueAxisReserve;
  const span = categorySpan({ x: plotX, w: Math.max(10, frame.plot.w - valueAxisReserve) }, 2, false, reserves.categoryEndRoom);
  const xTicks = planXTicks({
    model: x.model, lo: x.lo, hi: x.hi,
    xOf: (value) => span.x + (value - x.lo) / (x.hi - x.lo) * span.w,
    left: frame.plot.x, right: frame.plot.x + frame.plot.w,
    font: text.secondaryFont, measure: env.measure, weekStartsOn: domain.options.locale?.weekStartsOn,
    warnings, partialRow: (domain.options as { [X_PARTIAL_ROW]?: true })[X_PARTIAL_ROW] === true,
  });
  return { catPlan: xTickRowPlan(xTicks), categoryOverhang: 0, categoryRightOverhang: 0, crossesBetween: false, intervalTicks: undefined, xTicks };
}

function categoryStep(width: number, n: number, between: boolean): number {
  return between ? width / n : n > 1 ? width / (n - 1) : width;
}

/**
 * The span the categories take inside the plot. The plot, its baseline and
 * its gridlines keep their width; the first and last category move in until
 * each end keeps the room the reserves ask for, so ticks, marks, dividers
 * and labels all read the moved positions. Between bands an end already
 * sits half a step in, and only the rest comes off the span; each round
 * below moves that half step by 1/n of the change, so three settle it.
 */
function categorySpan(plot: { x: number; w: number }, n: number, between: boolean, room: LineReserves['categoryEndRoom']): { x: number; w: number } {
  // An end value wider than the plot asks for more room than there is, and
  // the rounds below then grew both insets past the plot. The two ends share
  // at most half the plot; a value that still does not fit is its label's
  // to place or drop.
  const scale = Math.min(1, plot.w / 2 / Math.max(room.left + room.right, 1e-9));
  let left = 0;
  let right = 0;
  for (let round = 0; round < 3; round++) {
    const half = between ? (plot.w - left - right) / (2 * n) : 0;
    left = Math.max(0, room.left * scale - half);
    right = Math.max(0, room.right * scale - half);
  }
  return { x: plot.x + left, w: plot.w - left - right };
}

/**
 * A drawn grid ends on its top tick (`axisGrid`), and line labels stay inside
 * the plot. A label near the top keeps its seat: the scale starts below the
 * plot top by what the seat needs beyond the room the data leaves under the
 * top tick, and by nothing when that room already holds it. A value sits
 * 5px over its point (labels.ts, 'above'); where its line climbs on to a
 * higher neighbour, which crosses that seat, it takes the one over it
 * ('aboveShifted', two label heights and 9px). An end name is centred on
 * its point, a stacked chart's on the middle of its band.
 */
/**
 * Whether every unlabelled forecast boundary keeps its "AC | FC" header seat clear: over the
 * header's x span (the divider, 8 px of air and both words), no drawn value comes within
 * `clearance` (in data units) of the top of the scale, and the split value keeps `valueRow`
 * more for its label.
 */
function forecastHeaderClear(domain: LineDomain, forecast: readonly ForecastBoundary[], xOf: (ci: number) => number, plotRight: number,
  measure: TextMeasurer, font: FontSpec, header: string, actual: string | undefined, clearance: number, valueRow: number): boolean {
  const fcW = measure(header, font).width;
  const acW = actual ? measure(actual, font).width : 0;
  const n = domain.cats.length;
  const at = forecastDividerAt(domain);
  return forecast.filter((boundary) => !boundary.labelled).every((boundary) => {
    const x = forecastBoundaryX(boundary, xOf, at);
    const lo = x - (acW > 0 ? acW + 8 : 0) - 2;
    const hi = Math.min(plotRight, x + fcW + 10);
    return domain.drawnSeries.every((series) => {
      const row = domain.pv[domain.rowOf.get(series)!] ?? [];
      // The split value prints over its point, under the header: it needs its own row too.
      const split = row[boundary.lastActualIndex];
      if (split !== null && split !== undefined && split > domain.dHi - clearance - valueRow) return false;
      for (let ci = 0; ci < n; ci += 1) {
        const v = row[ci];
        if (v === null || v === undefined) continue;
        const x0 = xOf(ci);
        const next = ci + 1 < n ? row[ci + 1] : undefined;
        const x1 = ci + 1 < n ? xOf(ci + 1) : x0;
        // The segment from this point to the next, where it meets the header span.
        if (x0 >= lo && x0 <= hi && v > domain.dHi - clearance) return false;
        if (next !== null && next !== undefined && x1 > lo && x0 < hi && x1 > x0) {
          const peak = Math.max(...[Math.max(lo, x0), Math.min(hi, x1)].map((px) => v + (next - v) * (px - x0) / (x1 - x0)));
          if (peak > domain.dHi - clearance) return false;
        }
      }
      return true;
    });
  });
}

function gridTopRoom(domain: LineDomain, reserves: LineReserves, text: LineText, plotH: number): number {
  if (domain.gridDataHi === undefined) return 0;
  const room = (value: number, seat: number): number => seatRoom(value, [domain.dLo, domain.dHi], seat, plotH);
  let top = 0;
  for (const label of reserves.endpoint.endLabels) {
    const di = domain.dataSeries.indexOf(label.s);
    const end = domain.isStacked && di >= 0
      ? (domain.cumTop[di]![label.ci]! + domain.cumBot[di]![label.ci]!) / 2
      : domain.pv[domain.rowOf.get(label.s)!]?.[label.ci] ?? domain.gridDataHi;
    top = Math.max(top, room(end, (label.h + 2) / 2));
  }
  if (domain.isStacked) return top;
  // The values the point pass prints (valueLabels, authored cell labels).
  const { labelModes } = domain;
  const picks = pointLabelSelection({
    valueLabels: labelModes.values, valueLabelsAuthored: domain.options.valueLabels !== undefined, labelOnly: domain.labelOnly,
    lastWithheld: new Set(usesEndLabelKey(domain.options) ? domain.drawnSeries.map(series => series.id) : []), contentOf: text.contentOf,
    valueContent: defaultValueContent(domain.variant, labelModes.seriesValueContent), drawnSeries: domain.drawnSeries, pv: domain.pv, rowOf: domain.rowOf,
    flagged: flaggedPoints(domain), variant: domain.variant,
  });
  for (const { series, row, only } of picks) {
    for (const ci of only) {
      if (series.vals[ci]?.labelOverride === false) continue;
      const value = row[ci]!;
      const climbs = (row[ci - 1] ?? -Infinity) > value || (row[ci + 1] ?? -Infinity) > value;
      top = Math.max(top, room(value, climbs ? 2 * text.labelH + 9 : text.labelH + 5));
    }
  }
  return top;
}

/** The value-axis title in its own row sits this far under the top of the head band. */
const AXIS_TITLE_TOP = 4;
/** From a title's right end to the next thing in its row: the FC header, or a CAGR arm's leg under it. */
const TITLE_ROW_GAP = 8;

/**
 * A value-axis title takes no row of its own where the forecast header row
 * has room for it: left of every "FC" and of every CAGR arm's leg, which
 * would reach down into the row, and with no phase row between it and the
 * top tick label. A bracket band spans the row and keeps the title's row.
 */
function titleSharesForecastRow(title: ValueAxisTitle, x: number, row: {
  forecastHeader: string; forecast: readonly ForecastBoundary[]; forecastHeaderHeight: number; phaseHeaderHeight: number; hasBracketBand: boolean; forecastAt: 'point' | 'band';
  annList: readonly Annotation[]; cats: readonly { id: Id }[]; xOf: (ci: number) => number; plotX: number; plotW: number;
  tickFont: FontSpec; measure: TextMeasurer;
}): boolean {
  if (row.forecastHeaderHeight === 0 || row.phaseHeaderHeight > 0 || row.hasBracketBand) return false;
  const fcWidth = row.measure(row.forecastHeader, row.tickFont).width;
  const headers = row.forecast.filter((boundary) => !boundary.labelled)
    .map((boundary) => Math.max(row.plotX, Math.min(forecastBoundaryX(boundary, row.xOf, row.forecastAt) + 4, row.plotX + row.plotW - fcWidth)));
  const at = (ref: unknown, fallback: number): number => {
    const id = typeof ref === 'string' ? ref : (ref as { categoryId?: unknown } | undefined)?.categoryId;
    const index = row.cats.findIndex((category) => category.id === id);
    return row.xOf(index >= 0 ? index : fallback);
  };
  const legs = row.annList.flatMap((annotation) => annotation.kind === 'cagr'
    ? [at(annotation.from, 0), at(annotation.to, row.cats.length - 1)] : []);
  return x + title.width + TITLE_ROW_GAP <= Math.min(minOf(headers), minOf(legs));
}

/** The plot rect (category band below; forecast, phase, CAGR and bracket headroom above) and the scales. */
export function linePlotArea(
  env: LineEnv,
  domain: LineDomain,
  text: LineText,
  reserves: LineReserves,
  framed: { frame: FrameResult; margin: LineArea['margin']; leftMargin: number },
  warnings: LintWarning[],
): LineArea {
  const { theme, measure, isBump, size } = env;
  const { options, cats, seriesNorm, drawnSeries, phases, dLo, dHi } = domain;
  const { frame } = framed;
  const { annList } = reserves;
  const axis = valueAxisTicks(env, domain, frame);
  // A numerator under a fifth of its denominator lies flat on
  // the scale they share and cannot be read off it, so each chip prints both.
  const peak = (id: Id | undefined): number => Math.max(0, maxOf((seriesNorm.find((s) => s.id === id)?.vals ?? []).map((cell) => Math.abs(cell.v ?? 0))));
  const flatNumerator = options.ratioTier !== undefined && peak(options.ratioTier.numeratorSeriesId) < peak(options.ratioTier.denominatorSeriesId) / 5;
  const ratioTierPrepared = prepareRatioTier(options.ratioTier, cats, seriesNorm, theme, measure, Math.max(10, frame.plot.w - axis.valueAxisReserve), flatNumerator ? domain.fmt : undefined, options.target, notApplicableGlyph(options.strings), options.locale?.language);
  warnings.push(...ratioTierPrepared.warnings);
  const row = categoryRow(env, domain, text, reserves, frame, axis.valueAxisReserve, warnings);
  const { catPlan, categoryOverhang, categoryRightOverhang, crossesBetween, intervalTicks } = row;
  const xTicks = 'xTicks' in row ? row.xTicks : undefined;
  // Read from annList, not options.annotations: bump drops the value-arithmetic
  // kinds, and reserving headroom for a bracket never drawn is dead space.
  const hasCagr = annList.some((a) => a.kind === 'cagr');
  const hasBracketBand = annList.some((a) => a.kind === 'band' && a.style === 'bracket');
  const phaseHeaderHeight = phases ? text.labelH + 8 : 0;
  const forecast = forecastBoundaries(drawnSeries, cats, annList, phases, domain.isStacked);
  const forecastHeaderHeight = forecast.some((boundary) => !boundary.labelled) ? measure(options.strings!.forecastHeader!, text.secondaryFont).height + 8 : 0;
  // A drawn value axis carries its "Measure, unit" title in
  // the top row of the head band. A rank ladder is no measure and has none.
  const axisTitle = axis.axisShown && !isBump && text.kindSetting('axisTitle') !== false
    ? planValueAxisTitle(valueAxisTitleText(theme, options.axisTitles?.primary, options,
      valueAxisUnit(options.unit, domain.dataSeries, domain.variant === 'stacked100-area')), theme, measure, frame.plot.w)
    : undefined;
  // The plot's x extent is known before its head band: the header rows only move it down.
  const plotX = frame.plot.x + (axis.axisShown || axis.disclosedTicks ? axis.valueAxisReserve : 0) + categoryOverhang;
  const plotW = Math.max(10, frame.plot.w - (axis.axisShown || axis.disclosedTicks ? axis.valueAxisReserve : 0) - categoryOverhang - categoryRightOverhang);
  const n = cats.length;
  const grid = domain.population ?? domain.timeline;
  const span = categorySpan({ x: plotX, w: plotW }, grid?.span ?? n, crossesBetween, reserves.categoryEndRoom);
  const xOf = (ci: number): number => (domain.timeline && !domain.population) || domain.x
    ? round2(liveCategoryX(ci, n, crossesBetween, span, grid))
    : liveCategoryX(ci, n, crossesBetween, span, grid);
  // The header rows stack up from the plot top: phase names, the forecast
  // header, then the CAGR and bracket bands; the axis title sits over them.
  // A stack whose top band runs under 15% of its column somewhere
  // prints those values over the band, so the head keeps a row for them.
  // Only the categories whose values print count, and a band counts as thin
  // when its estimated height cannot hold its value, not by its share alone:
  // "9" of 80 fits its band at 400 px.
  const top = domain.isStacked && domain.labelModes.values !== 'none' ? drawnSeries[drawnSeries.length - 1] : undefined;
  const topLast = top ? domain.lastIdxOf.get(top.id) ?? n - 1 : n - 1;
  const topFirst = top ? Math.max(0, domain.pv[domain.rowOf.get(top)!]!.findIndex((v) => v !== null && v !== undefined)) : 0;
  const valueCats = domain.labelModes.values === 'last' ? [topLast] : domain.labelModes.values === 'ends' ? [topFirst, topLast] : cats.map((_, ci) => ci);
  const estPlotH = frame.plot.h - catPlan.rowHeight - 8 - (8 + forecastHeaderHeight + phaseHeaderHeight + (hasCagr ? 30 : 0) + (hasBracketBand ? 30 : 0));
  const thinTop = top !== undefined && valueCats.some((ci) => {
    const value = domain.pv[domain.rowOf.get(top)!]![ci];
    const total = drawnSeries.reduce((sum, series) => sum + Math.abs(domain.pv[domain.rowOf.get(series)!]![ci] ?? 0), 0);
    if (value === null || value === undefined || total <= 0) return false;
    if (Math.abs(value) / total >= 0.15) return false;
    return !(dHi > dLo) || Math.abs(value) / (dHi - dLo) * estPlotH < text.labelH + 2 + THIN_TOP_AIR;
  });
  const topValueRow = thinTop ? text.labelH + 8 : 0;
  // The "AC | FC" header sits inside the plot, under its top gridline, where the data under
  // the header stays clear of it. The row above the plot then goes back to the data.
  const forecastHeaderInPlot = forecastHeaderHeight > 0 && domain.isArea && !domain.isStacked && phaseHeaderHeight === 0
    && !hasCagr && !hasBracketBand && topValueRow === 0 && dHi > dLo
    && forecastHeaderClear(domain, forecast, xOf, plotX + plotW, measure, text.secondaryFont, options.strings!.forecastHeader!, actualHeader(domain),
      (dHi - dLo) * (forecastHeaderHeight + 4) / Math.max(1, estPlotH + forecastHeaderHeight),
      (dHi - dLo) * (text.labelH + 5) / Math.max(1, estPlotH + forecastHeaderHeight));
  const headerRows = (forecastHeaderInPlot ? 0 : forecastHeaderHeight) + phaseHeaderHeight + (hasCagr ? 30 : 0) + (hasBracketBand ? 30 : 0) + topValueRow;
  const titleInRow = axisTitle !== undefined && titleSharesForecastRow(axisTitle, frame.plot.x, {
    forecastHeader: options.strings!.forecastHeader!, forecast, forecastHeaderHeight: forecastHeaderInPlot ? 0 : forecastHeaderHeight, phaseHeaderHeight, hasBracketBand, forecastAt: forecastDividerAt(domain), annList, cats, xOf, plotX, plotW, tickFont: text.tickFont, measure,
  });
  const axisTitleBand = titleInRow ? 0 : valueAxisTitleBand(axisTitle, theme, measure, headerRows);
  const rawBandPad = (options as { [BAND_PAD]?: number })[BAND_PAD] ?? 0;
  const baseTopPad = 8 + axisTitleBand + headerRows;
  // Every top legend releases the outer head band. Real rows and the original
  // tick clearance stay inside the plot and retain their data-height floor.
  const headInPlot = frame.legend !== undefined && frame.legend.rect.y + frame.legend.rect.h <= frame.plot.y;
  // The tick band reserves what its labels measure; no tick row reserves
  // nothing. The ratio-tier branch adds the tier's caption gap on top.
  const showCategoryTickRow = text.kindSetting('category') !== false && cats.length > 0;
  if (showCategoryTickRow) pushAll(warnings, catPlan.warnings);
  const categoryTickGap = domain.isArea && !crossesBetween && axis.axisShown ? Math.max(6, measure('0', text.secondaryFont).height / 2 + 4) : 6;
  const categoryTickReserve = showCategoryTickRow ? catPlan.rowHeight + categoryTickGap + 2 : 0;
  const categoryBandHeight = ratioTierPrepared.tier
    ? 6 + catPlan.rowHeight + ratioTierMetrics.categoryCaptionGap - theme.space.tierGap
    : categoryTickReserve;
  const rawHNoBand = frame.plot.h - categoryBandHeight - (ratioTierPrepared.tier?.reserveHeight ?? 0) - (headInPlot ? 0 : baseTopPad);
  const minRawH = Math.max(10, options.mode === 'compact' ? 80 : 0);
  const maxBandPad = headInPlot
    ? Math.floor(plotHeightAfter(frame, size.height, rawHNoBand) - baseTopPad - minRawH)
    : Math.floor(rawHNoBand - minRawH);
  const bandPad = rawBandPad > 0 ? Math.max(0, Math.min(rawBandPad, maxBandPad)) : 0;
  const topPad = baseTopPad + bandPad;
  const plot = {
    x: plotX,
    y: frame.plot.y + (headInPlot ? 0 : topPad),
    w: plotW,
    h: plotHeightAfter(frame, size.height, frame.plot.h - categoryBandHeight - (ratioTierPrepared.tier?.reserveHeight ?? 0) - (headInPlot ? 0 : topPad)),
  };
  // reserve the measured label columns before the frame can accept a short plot.
  const endHeight = reserves.endpoint.endLabels.reduce((sum, label) => sum + label.h + 2, 0);
  const minPlot = Math.max(plotFloorRows(options) * text.labelH + 8, endHeight, reserves.referenceBands?.minHeight ?? 0)
    + (headInPlot && axisTitleBand + headerRows > 0 ? baseTopPad : 0);
  frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, size.height + (frame.deficit ?? 0) + minPlot - rawHNoBand);
  // A title sharing the forecast row clears the top tick label by the house gap.
  const axisTitleY = titleInRow
    ? frame.plot.y + baseTopPad - measure('0', text.secondaryFont).height / 2 - AXIS_TITLE_GAP - axisTitle!.height
    : frame.plot.y + AXIS_TITLE_TOP;
  // The ONE seam that makes this a rank chart: the range tuple is not flipped,
  // so the domain minimum (0.5, just above rank 1) lands at the TOP of the plot.
  const reverse = options.valueAxis?.reverse;
  const legendGap = headInPlot ? frame.plot.y - frame.legend!.rect.y - frame.legend!.rect.h : 0;
  const tickHead = headInPlot && axis.axisShown ? Math.max(0, measure('0', text.secondaryFont).height / 2 - legendGap) : 0;
  const innerHead = headInPlot ? Math.min(Math.max(tickHead, topPad), plot.h) : 0;
  const topRoom = innerHead + gridTopRoom(domain, reserves, text, plot.h - innerHead);
  const yRange: [number, number] = isBump
    ? reverse ? [plot.y + plot.h, plot.y] : [plot.y, plot.y + plot.h]
    : reverse ? [plot.y + innerHead, plot.y + plot.h] : [plot.y + plot.h, plot.y + topRoom];
  return {
    ...framed,
    ...axis,
    ratioTier: ratioTierPrepared.tier,
    categoryOverhang,
    catPlan,
    ...(intervalTicks && showCategoryTickRow ? { intervalTicks } : {}),
    showCategoryTickRow,
    categoryTickReserve,
    categoryTickGap,
    categoryBandHeight,
    forecast,
    forecastHeaderHeight,
    forecastHeaderInPlot,
    forecastPlot: headInPlot ? { ...plot, y: plot.y + innerHead, h: plot.h - innerHead } : plot,
    phaseHeaderHeight,
    axisTitle,
    axisTitleBand,
    axisTitleY,
    topPad,
    plot,
    y: linearScale([dLo, dHi], yRange),
    // Proportional positions land on 0.01 px, as the path coordinates drawn from them do.
    xOf,
    ...(domain.x && xTicks ? { xTicks, xOfValue: (value: number) => span.x + (value - domain.x!.lo) / (domain.x!.hi - domain.x!.lo) * span.w } : {}),
    // A continuous axis has no pitch: the mean spacing of its readings stands in where a step is read.
    step: domain.x ? span.w / Math.max(1, n - 1) : categoryStep(span.w, domain.population ? n : grid?.span ?? n, crossesBetween),
    categoryOrder: new Map(cats.map((category, index) => [category.id, index] as const)),
  };
}
