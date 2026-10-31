import { round2 } from '../../geometry';
import { notApplicableGlyph } from '../../format';
/**
 * Line phase 2: the scales in, scene nodes out. The value axis with
 * its baseline disclosure, the forecast headers, the line and area marks, the
 * gap fill, the fan washes, the phase fills and the targets, in paint order.
 * Everything the phase claims goes into an OccupiedIndex of its own, in claim
 * order. The helpers that raise labels as they draw (forecast headers, phase
 * names, target values) push into arrays of their own, which the label phase
 * puts in solver order.
 */

import { categoryBandFromCenters } from '../../annotateFields';
import { layoutValueAxis, straightBreakGlyph, valueAxisTitleRequest } from '../../axis';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import type { LabelRequest } from '../../label/solver';
import { strokeToken, HATCH_STRENGTH_DEFAULT, hatchGapFactor } from '../../theme';
import type { AxisGeometry, LintWarning, PaintWarningRule, SceneNode } from '../../types/scene';
import type { Theme } from '../../types/theme';
import { resolvePaintWarnings } from '../../paintWarnings';
import { lineSeriesAdjacentWarnings } from './adjacent';
import { renderGapFill, renderTargets } from './difference';
import { renderFanWashes } from './fan';
import { actualHeader, forecastDividerAt, forecastStroke, placeForecastHeaders } from './forecast';
import { pathFor, renderLineMarks, renderPhaseFills, reversePathTail } from './marks';
import { lineMeans } from './means';
import type { LineArea, LineDomain, LineEnv, LineMarkGeometry, LinePaints, LineReserves, LineText } from './model';
import { layoutReferenceBands } from './referenceBands';
import { drawLineTrends } from './trend';
import { pushAll } from '../../arrays';

/** Length of a date-interval tick under the plot; the category names start 6 px below the plot. */
const INTERVAL_TICK = 4;
/** Interval ticks closer than this (px) draw only where a label prints. */
const MIN_TICK_GAP = 2;
/** A stacked band's forecast stripes sit 1/√2 of the theme's second-cue pitch apart (9.6 px along x at the default). */
const BAND_HATCH_PITCH = Math.SQRT1_2;
/** The page colour's share in a stacked band's stripe at the default strength. */
const BAND_HATCH_SHARE = 0.45;

/** The forecast overlay of a fill: page-colour stripes over the fill's own colour (renderLineMarks' `hatch`). */
export function bandHatch(theme: Theme, hatchStrength: number | undefined): { gap: number; width: number; share: number } {
  return {
    gap: theme.pattern.hatchGap * hatchGapFactor({ strength: hatchStrength ?? HATCH_STRENGTH_DEFAULT.second, cue: 'second' }) * BAND_HATCH_PITCH,
    width: strokeToken(theme, 'hair'),
    share: BAND_HATCH_SHARE * (0.5 + 0.5 * (hatchStrength ?? HATCH_STRENGTH_DEFAULT.second) / 100) / (0.5 + 0.5 * HATCH_STRENGTH_DEFAULT.second / 100),
  };
}

/** Phase 2: the plot area, scales and paints in, every mark in paint order out. */
export function layoutLineMarks(
  env: LineEnv,
  domain: LineDomain,
  area: LineArea,
  paints: LinePaints,
  text: LineText,
  reserves: LineReserves,
  warnings: LintWarning[],
): LineMarkGeometry {
  const { theme, measure, highlights } = env;
  const { options, drawnSeries, pv, rowOf, cats, isStacked, isArea, compositionInvalidAt, cumTop, cumBot, interpolationFor, dLo, dHi } = domain;
  const { plot, y, xOf } = area;
  const { tickFont, labelFont } = text;
  const nodes: SceneNode[] = [...area.frame.nodes];
  /**
   * Which series takes the ring. The object form names it;
   * `'ring'` picks the primary series, which is the hero where `emphasis`
   * named one and otherwise the first data series that is not a prior year,
   * a plan or a forecast, so a board of AC and PY rings the AC.
   */
  const latestPointSeries = options.latestPoint === undefined || options.latestPoint === 'none'
    ? undefined
    : typeof options.latestPoint === 'object'
      ? options.latestPoint.series
      : (drawnSeries.find((s) => s.id === paints.heroId)
        ?? domain.dataSeries.find((s) => s.scenario === undefined || s.scenario === 'AC')
        ?? domain.dataSeries[0])?.id;
  const claims = createOccupiedIndex({ x: 0, y: 0, w: env.size.width, h: env.size.height });
  const axes: AxisGeometry[] = [];
  if (area.axisShown || area.disclosedTicks) {
    const axisResult = layoutValueAxis(
      {
        scale: y,
        plot,
        orient: 'y',
        // A plain line with a shown value axis draws light gridlines by default;
        // a panel that shares its scale with other panels keeps their (gridless) look.
        gridlines: options.valueAxis?.gridlines ?? ((domain.variant === 'line' || domain.variant === 'area' && domain.drawnSeries.length === 1)
          && options.valueAxis?.show === true && options.scaleGroup === undefined),
        format: area.axisFmt,
        ...(area.axisTickSpec ? { formatSpec: area.axisTickSpec } : {}),
        theme,
        measure,
        ...(area.bumpTicks ? { ticks: area.bumpTicks, keepEndTicks: true } : {}),
        ...(!area.bumpTicks && area.disclosedTicks ? { ticks: area.disclosedTicks, keepEndTicks: true } : {}),
        ...(!area.bumpTicks && !area.disclosedTicks && area.stepTicks ? { ticks: area.stepTicks } : {}),
      },
      claims,
    );
    if (area.discloseNonzeroBaseline) {
      const glyph = straightBreakGlyph(theme, { x: plot.x, y: plot.y + plot.h - 7 }, 'axis:y:baseline-disclosure', {}, { token: 'axis' }, 'baselineDisclosure');
      axisResult.nodes.push(...glyph.nodes);
      claims.claim(glyph.rect, 'axis', {}, 'baselineDisclosure');
      axisResult.axis.baselineDisclosure = { value: area.baselineValue, rect: glyph.rect, nodeIds: glyph.nodeIds };
    }
    pushAll(nodes, axisResult.nodes);
    axes.push(axisResult.axis);
  }
  // categoryAxis.dateTicks: a short tick under the plot at every interval, labelled or not.
  // On a line that sampled itself, ticks closer than MIN_TICK_GAP merge into a bar (months over a century), so only the labelled ones draw.
  const tickXs = domain.autoSampled ? area.intervalTicks?.flatMap((tick, ci) => (tick ? [xOf(ci)] : [])) : undefined;
  const crowded = tickXs?.some((x, k) => k > 0 && x - tickXs[k - 1]! < MIN_TICK_GAP) === true;
  area.intervalTicks?.forEach((tick, ci) => {
    if (!tick || (crowded && !area.catPlan.keep[ci])) return;
    const x = xOf(ci);
    const top = plot.y + plot.h;
    nodes.push({ t: 'line', id: `axis:x:tick:${cats[ci]!.id}`, x1: x, y1: top, x2: x, y2: top + INTERVAL_TICK, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: { categoryId: cats[ci]!.id }, part: 'tick' });
    claims.claim({ x: x - 0.5, y: top, w: 1, h: INTERVAL_TICK }, 'axis', { categoryId: cats[ci]!.id }, 'tick');
  });
  // A continuous axis: a short tick under the plot at each scale tick, labelled or thinned.
  if (area.xTicks && area.xOfValue && area.showCategoryTickRow) {
    const top = plot.y + plot.h;
    area.xTicks.values.forEach((value, i) => {
      const x = round2(area.xOfValue!(value));
      nodes.push({ t: 'line', id: `axis:x:scale-tick:${i}`, x1: x, y1: top, x2: x, y2: top + INTERVAL_TICK, stroke: { token: 'axis' }, width: strokeToken(theme, 'rule'), owner: {}, part: 'tick' });
      claims.claim({ x: x - 0.5, y: top, w: 1, h: INTERVAL_TICK }, 'axis', {}, 'tick');
    });
  }
  // Named reference bands: under the marks, their names in the column right of the plot.
  const referenceBands = reserves.referenceBands
    ? layoutReferenceBands(theme, { column: reserves.referenceBands, plot: area.forecastPlot, y, claims, warnings })
    : undefined;
  if (referenceBands) pushAll(nodes, referenceBands.bands);
  // the value-axis title is a label in the top row of the head band.
  const headerRequests: LabelRequest[] = area.axisTitle && area.axisShown
    ? [valueAxisTitleRequest(area.axisTitle, { x: area.frame.plot.x, y: area.axisTitleY }, 'start', 'axis:y:title')]
    : [];
  // The "FC" row sits on the plot top (over the phase row, when there is one), centred over the divider it names.
  placeForecastHeaders(area.forecast, xOf, area.forecastPlot, area.forecastHeaderInPlot ? area.forecastPlot.y + 2 : area.forecastPlot.y - area.phaseHeaderHeight - area.forecastHeaderHeight, text.secondaryFont, measure, headerRequests, claims, options.strings!.forecastHeader!, forecastDividerAt(domain), actualHeader(domain));
  const baseY = dLo <= 0 && dHi >= 0 ? y(0) : plot.y + plot.h;
  const rendered = renderLineMarks({
    theme,
    highlights: env.highlights,
    drawnSeries, refSeries: domain.refSeries, pv, rowOf, cats, isStacked, isArea, compositionInvalidAt, y, cumTop, cumBot, xOf,
    hasSuppressed100: domain.nmCats100.size > 0 || domain.naCats100.size > 0, baseY, plot,
    range: domain.x?.range, xOfValue: area.xOfValue,
    // A stacked band's forecast overlay is a second cue (hatchStrength). Its
    // stripes are the page colour at 45% over the band's own fill (one solid colour, not an opacity), hair
    // weight, 9.6 px apart along x at the default strength; lower strengths spread and fade them.
    hatch: bandHatch(theme, options.hatchStrength),
    seriesPaint: paints.series,
    areaFillPaint: paints.areaFill,
    areaFilled: paints.areaFilled,
    // A plain line's forecast keeps its colour; the dashes, open markers and divider mark it.
    forecastLinePaint: (series, index) => isArea || domain.variant === 'line' ? paints.series(series, index) : forecastStroke(paints.series(series, index), theme,
      paints.seriesCrossesShadedBand(series)),
    lineWidthOf: paints.lineWidthOf,
    lineHollowOf: paints.lineHollowOf,
    interpolationFor,
    dashOf: paints.dashOf,
    markerOf: paints.markerOf,
    hollowAt: paints.hollowAt,
    rebased: domain.rebased,
    variant: domain.variant,
    pctFmt: env.pctFmt,
    shareTexts: domain.shareTexts,
    authoredPctFmt: env.authoredPctFmt,
    fmt: domain.fmt,
    seriesFmt: domain.valueSpec.forSeries,
    absOf: domain.absOf,
    bumpPointState: paints.bumpPointState,
    inlineNamesEnabled: reserves.endpoint.inlineNamesEnabled,
    ...(latestPointSeries === undefined ? {} : { latestPointSeries }),
    ...(domain.bumpDerived ? { bump: domain.bumpDerived, bumpOmitted: domain.bumpOmitted } : {}),
    nmCats100: domain.nmCats100,
    naCats100: domain.naCats100,
    naGlyph: notApplicableGlyph(options.strings),
    labelFont,
    measure,
    refPaintOf: paints.ref,
    nodes,
    occupied: claims,
  });
  const { marks, analyticalSceneStart, paintedAreaCats } = rendered;
  const paintWarningRules: PaintWarningRule[] = [];
  const before = warnings.filter(warning => !['pie-ramp-crowded', 'likert-ramp-invisible', 'band-lightness-insufficient', 'series-adjacent-similar', 'highlight-reads-as-loss', 'line-band-authored-contrast'].includes(warning.code)).length;
  pushAll(warnings, lineSeriesAdjacentWarnings({ marks, nodes, cats, drawnSeries, cumBot, cumTop, paintedAreaCats, isStacked, isArea, highlights, paintCss: paints.css, theme, capture: { rules: paintWarningRules, before } }));
  for (const rule of paints.bandRules()) {
    paintWarningRules.push({ ...rule, before });
    pushAll(warnings, resolvePaintWarnings(theme, [{ ...rule, before }]));
  }
  // shaded difference between two named series
  renderGapFill({
    range: domain.x?.range, xOfValue: area.xOfValue,
    gapFillSeries: domain.gapFillSeries, gapFill: options.gapFill, interpolationFor, pv, rowOf, cats, compositionInvalidAt, xOf, y,
    warnings, occupied: claims, nodes, marks, analyticalSceneStart,
  });
  // uncertainty fan: nested washes, outermost first, behind everything
  renderFanWashes(theme, {
    range: domain.x?.range, xOfValue: area.xOfValue,
    fan: domain.fan, fanPaints: paints.fanPaints, fanLadder: paints.fanLadder, interpolationFor, pv, rowOf, cats, compositionInvalidAt, xOf, y,
    pathFor, reversePathTail, fmt: domain.fmt, numberSpec: domain.valueSpec.spec, occupied: claims, warnings, nodes, marks, analyticalSceneStart,
  });
  const phaseRequests: LabelRequest[] = [];
  const phaseDerived = renderPhaseFills(theme, {
    range: domain.x?.range, xOfValue: area.xOfValue,
    phases: domain.phases, pv, rowOf, cats, xOf, y, baseY, plot: area.forecastPlot, phaseHeaderHeight: area.phaseHeaderHeight,
    paletteRamp: env.paletteRamp, palette: options.palette, fmt: domain.fmt, measure, tickFont,
    labelRequests: phaseRequests, occupied: claims, nodes, marks, analyticalSceneStart, forecast: area.forecast,
  });
  // authored future/goal targets
  drawLineTrends(theme, domain, area, paints, nodes, claims);
  const targetRequests: LabelRequest[] = [];
  const targetLabelIds = renderTargets(env.theme, {
    targets: domain.targets, categoryOrder: area.categoryOrder, xOf, y, nodes, occupied: claims, fmt: domain.fmt, labelFont, measure,
    labelRequests: targetRequests, plot, marks, rightEdge: env.size.width - 4,
  });
  const { meanValue, meanValueFor } = lineMeans(domain.population?.plotted ?? pv, rowOf, drawnSeries, domain.population?.categories ?? cats, !domain.rebased && domain.variant !== 'stacked100-area');
  claimValueLines(reserves.annList, meanValue, meanValueFor, cats, area, claims);
  if (referenceBands) pushAll(nodes, referenceBands.column);
  return {
    nodes, claims, axes, rendered, marks, paintWarningRules, headerRequests, phaseRequests, targetRequests, phaseDerived, targetLabelIds,
    baseY, meanValue, meanValueFor,
  };
}

/**
 * valueLine pre-claims: the level a valueLine will draw at, scoped or not,
 * must agree with the annotation pass (invalid scopes claim nothing; the pass
 * warns).
 */
function claimValueLines(
  annList: LineReserves['annList'],
  meanValue: LineMarkGeometry['meanValue'],
  meanValueFor: LineMarkGeometry['meanValueFor'],
  cats: LineDomain['cats'],
  area: LineArea,
  claims: OccupiedIndex,
): void {
  const { plot, y, xOf } = area;
  const resolveBand = annList.some(ann => ann.kind === 'band' && ann.from !== undefined && ann.to !== undefined && Boolean(ann.label))
    ? categoryBandFromCenters(cats.map((c) => c.id), plot, xOf, 'x')
    : undefined;
  annList.forEach((ann, k) => {
    if (ann.kind !== 'valueLine') return;
    const scoped = ann.seriesId !== undefined || ann.from !== undefined || ann.to !== undefined;
    let v: number | undefined;
    if (!scoped) v = ann.value === 'mean' || ann.value === undefined ? meanValue : ann.value;
    else if ((ann.value === 'mean' || ann.value === undefined) && (ann.from === undefined) === (ann.to === undefined)) {
      const resolved = meanValueFor({ seriesId: ann.seriesId, from: ann.from, to: ann.to });
      v = 'error' in resolved ? undefined : resolved.value;
    }
    if (v === undefined) return;
    const fromBand = ann.from !== undefined ? resolveBand?.(ann.from) : null;
    const toBand = ann.to !== undefined ? resolveBand?.(ann.to) : null;
    const x0 = fromBand && toBand && 'x' in fromBand && 'x' in toBand ? Math.min(fromBand.x, toBand.x) : plot.x;
    const x1 = fromBand && toBand && 'x' in fromBand && 'x' in toBand ? Math.max(fromBand.x + fromBand.w, toBand.x + toBand.w) : plot.x + plot.w;
    claims.claim({ x: x0, y: y(v) - 1, w: Math.max(x1 - x0, 0), h: 2 }, 'annotation', { annotationId: ann.id ?? `valueLine-${k + 1}` });
  });
}
