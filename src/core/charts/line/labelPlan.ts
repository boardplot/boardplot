/**
 * Line phase 3: the label requests the solver places, in the order
 * the solver sees them. Forecast headers, the ratio tier, phase names and
 * target values come from the mark phase; this phase adds inline names,
 * endpoint labels, bump start names, point values and the
 * category row. It reads the phase 2 struct and claims nothing.
 */

import { GAP_BRACKET_REFUSED, gapBracketPairs } from '../../annotateParts';
import type { Rect } from '../../geometry';
import { screenEdges, seatValuesOnGround, type AreaGround } from '../../label/areaGround';
import { PRIORITY, type LabelRequest } from '../../label/solver';
import { addRatioTierRequests, type RatioTierRequestState } from '../../ratioTier';
import type { Annotation } from '../../types/annotations';
import type { Id } from '../../types/cell';
import type { LintWarning } from '../../types/scene';
import { joinTieValues, placeBumpStartLabels, placeBumpTieLabels } from './bump';
import { defaultValueContent, fanEdgeInKey, flaggedPoints, lineFocusFont, lineToDateIds, placeCategoryLabels, placeEndpointLabels, placeInlineSeriesLabels, placePointValueLabels, pointValueWidths, usesEndLabelKey, usesInlineFallback, usesWideEndLabels, valueUnit } from './labels';
import { placeXTickLabels } from './xTicks';
import { outerFanEdge } from './fan';
import { restValuesHidden } from '../../restLabels';
import { forecastBoundaryX, shadesFills } from './marks';
import { chartString } from '../../strings';
import { disclosuresShown } from '../../notes';
import { saysToDate } from '../../partialPeriod';
import { effectiveFill, emphasisWeight } from '../../theme';
import type { LineArea, LineDomain, LineEnv, LineMarkGeometry, LinePaints, LineReserves, LineText } from './model';
import { pushAll } from '../../arrays';

/** Phase 3 output: the requests in solver order, plus what the post-solve steps need. */
export interface LineLabelPlan {
  labelRequests: LabelRequest[];
  ratioTierRequestState: RatioTierRequestState | undefined;
  /** Where each endpoint and bump start leader starts, by label id. */
  endpointLeaderAnchors: Map<Id, { x: number; y: number }>;
  catLabelsShown: boolean;
  /** The reading names under each time-axis partial label `xpartial:<k>`, for the warning when one drops. */
  xPartialGroups: string[][];
  endpointFallback: boolean;
  endpointWiden: boolean;
}

/** Phase 3: every label request, in the order the solver has always seen them. */
export function planLineLabels(
  env: LineEnv,
  domain: LineDomain,
  area: LineArea,
  paints: LinePaints,
  text: LineText,
  reserves: LineReserves,
  scene: LineMarkGeometry,
  warnings: LintWarning[],
): LineLabelPlan {
  const { isBump, theme, size, measure, highlights } = env;
  const { drawnSeries, cats, rowOf, isStacked, isArea, cumTop, cumBot, interpolationFor } = domain;
  const { plot, y, xOf, categoryOrder } = area;
  const { labelFont, labelH } = text;
  const focusName = lineFocusFont(env, domain, text.nameFont, emphasisWeight(theme));
  const focusValue = lineFocusFont(env, domain, labelFont, emphasisWeight(theme));
  const { marks } = scene;
  const { paintedAreaCats } = scene.rendered;
  const labelRequests: LabelRequest[] = [...scene.headerRequests];
  const ratioTierRequestState = area.ratioTier
    ? addRatioTierRequests(area.ratioTier, labelRequests, {
        plot,
        categoryBandHeight: area.categoryBandHeight,
        categoryCenter: (categoryId) => xOf(categoryOrder.get(categoryId)!),
        theme,
        measure,
      })
    : undefined;
  pushAll(labelRequests, scene.phaseRequests);
  pushAll(labelRequests, scene.targetRequests);
  const inlineNamesEnabled = reserves.endpoint.inlineNamesEnabled;
  // The band dividers the annotation pass draws later stand between two
  // categories (annotateFields' band edges), where an inline name sits, or on
  // a forecast split; the name keeps off them.
  const last = cats.length - 1;
  const forecastXs = area.forecast.map((boundary) => forecastBoundaryX(boundary, xOf, 'point'));
  const dividerXs = [...forecastXs, ...reserves.annList.flatMap((a) => {
    if (a.kind !== 'band' || !a.divider || a.from === undefined || a.to === undefined) return [];
    const from = categoryOrder.get(a.from);
    const to = categoryOrder.get(a.to);
    return [
      ...(from !== undefined && a.divider !== 'end' ? [from === 0 ? plot.x : (xOf(from - 1) + xOf(from)) / 2] : []),
      ...(to !== undefined && a.divider !== 'start' ? [to === last ? plot.x + plot.w : (xOf(to) + xOf(to + 1)) / 2] : []),
    ];
  })];
  placeInlineSeriesLabels({
    enabled: inlineNamesEnabled, drawnSeries, marks, interpolationFor, categoryOrder, plot, measure, dividerXs,
    labelFont: text.nameFont, labelH, labelRequests, highlights, heroId: paints.heroId, beside: usesInlineFallback(domain.options),
    ...(focusName ? { focusFont: focusName } : {}),
  });
  // A name that cannot be placed inside the bump rank band is hidden by the
  // solver: a name in the footnote band is not a name the reader can attach
  // to a rank.
  const outsideRankBand = (rect: Rect): boolean =>
    isBump && (rect.y < plot.y - 0.5 || rect.y + rect.h > plot.y + plot.h + 0.5);
  // endpoint labels: spread vertically in the reserved right margin
  const { endLabels, endSwatchReserve, endpointSwatches, columnGap } = reserves.endpoint;
  const merged = new Set<Id>();
  const bounded = !isBump && !isArea && !domain.fan ? { lineHeight: labelH, fallback: false, wide: usesWideEndLabels(domain.options), widen: false } : undefined;
  const endpointLeaderAnchors = placeEndpointLabels({
    endLabels, endSwatchReserve, endpointSwatches,
    // The names start just past the line ends, or past the plot edge (reserves.namesAtPlotEdge).
    columnX: (reserves.namesAtPlotEdge || cats.length === 0 ? plot.x + plot.w : xOf(cats.length - 1)) + columnGap, marks, paintedAreaCats, cats, plot, size, isStacked, isArea, y, cumTop, cumBot,
    outsideRankBand, warnings, labelRequests, labelFont: text.nameFont, highlights, keyPaint: paints.keyPaint, seriesPaint: paints.series,
    // A line that ends early is named at its own end unless the author asks for the gutter.
    atLineEnd: (domain.options.endLabelPlacement ?? env.theme.labels?.endLabelPlacement ?? 'lineEnd') === 'lineEnd',
    ...(!isBump && domain.labelModes.values !== 'none' && text.contentOf('point', ['absolute']) !== null ? { valuesAtEnd: { merged, measure } } : {}),
    crowdedEnds: !isBump,
    // Under a grey highlight the names print in their
    // line's ink with the value beside them; a near-zero group keeps its shared label.
    joinEvery: domain.variant === 'line' && env.anyHighlight && domain.options.highlightMode !== 'fade' && !reserves.endpoint.nearZeroTail,
    rankLadder: isBump,
    ...(bounded ? { bounded } : {}),
  });
  const lastCarried = new Set([...merged, ...reserves.keyValues.keys()]);
  const valueInput: Parameters<typeof placePointValueLabels>[0] = {
    drawnEdges: scene.rendered.rangeEdges,
    valueLabels: domain.labelModes.values,
    firstWithheld: domain.x?.range && isArea && usesEndLabelKey(domain.options) && domain.labelModes.values === 'ends'
      ? new Set(drawnSeries.filter(s => {
        const first = domain.pv[rowOf.get(s)!]!.findIndex(v => v !== null);
        return first >= 0 && s.vals[first]!.labelOverride === undefined && reserves.keyValues.has(s.id);
      }).map(s => s.id)) : undefined,
    valueLabelsAuthored: domain.options.valueLabels !== undefined, labelOnly: domain.labelOnly,
    // A group that ends on one printed zero prints that value once.
    lastWithheld: new Set([...(reserves.endpoint.nearZeroTail?.seriesIds.slice(1) ?? []), ...lastCarried]), lastCarried,
    endNamed: new Set([...endLabels.map((label) => label.s.id), ...(reserves.endpoint.nearZeroTail?.mode === 'shared' ? reserves.endpoint.nearZeroTail.seriesIds : [])]),
    valueContent: defaultValueContent(domain.variant, domain.labelModes.seriesValueContent), ...valueUnit(domain.options, isBump, domain.rebased),
    contentOf: text.contentOf, variant: domain.variant, drawnSeries, pv: domain.labelPv, rowOf, cats,
    rebased: domain.rebased, composeText: text.composeText, composeEndText: text.composeEndText, absOf: domain.absOf, measure, labelFont, highlights, isStacked, y, cumTop,
    cumBot, xOf, plot: area.forecastPlot, paintedAreaCats, areaFillPaint: paints.areaFill, paintCss: paints.css, labelH, step: area.step,
    density: env.density, labelRequests, restHidden: (series) => restValuesHidden(domain.options, series.colorRole), interpolationFor: domain.interpolationFor, sharesWithheld: domain.sharesWithheld, warnings,
    // Authored furniture that divides at a transition stands on the same split.
    dividers: area.forecast.map((boundary, index) => ({ x: forecastXs[index]!, ci: boundary.lastActualIndex })),
    ...(isBump ? { bump: { headroom: area.topPad, named: new Set([...endLabels, ...reserves.startLabels].map((label) => `${label.s.id}:${label.ci}`)) } } : {}),
    flagged: flaggedPoints(domain),
    ...(focusValue ? { focusFont: focusValue } : {}),
    toDate: { ids: lineToDateIds(env, domain, text), words: domain.options.strings?.toDate ?? chartString(domain.options, 'toDate'), theme: env.theme, measure },
  };
  // bump: entity names at the first ranked point, in the rail left of the
  // rank ticks; an entrant's name stands left of its own first marker, clear
  // of the value over it.
  const valueWidths = isBump ? pointValueWidths(valueInput) : new Map<string, number>();
  placeBumpStartLabels({
    startLabels: reserves.startLabels, marks, cats, plot, size, leftMargin: area.leftMargin, outsideRankBand, endpointLeaderAnchors,
    labelRequests, labelFont: text.nameFont, highlights, warnings, valueWidth: (label) => valueWidths.get(`${label.s.id}:${label.ci}`) ?? 0,
  });
  placeBumpTieLabels({ strings: domain.options.strings, bump: domain.bumpDerived, marks, outsideRankBand, labelRequests, font: text.tickFont, measure });
  placePointValueLabels(valueInput);
  if (!isStacked) seatValuesOffGapGuides(domain, area, reserves.annList, labelRequests, labelH);
  // A value may sit on a fill where it clears that fill's edges by the solver's pad.
  // A shading draws a mix over the fills (fillShadings) that this plan cannot see, so other series' values keep off them.
  // A stacked value sits in its own band, which keeps it clear of the next band's edge.
  const grounds: AreaGround[] = scene.rendered.areaOutlines.filter((outline) => !outline.stacked).map((outline) => ({ seriesId: outline.seriesId, ...screenEdges(outline.top, outline.bottom), paint: outline.paint, ...(outline.forecast ? { pattern: 'hatch45' as const } : {}) }));
  seatValuesOnGround(labelRequests, grounds, 2, (ground) => ground.pattern ? effectiveFill(paints.css(ground.paint), ground.pattern, env.theme) : paints.css(ground.paint), !shadesFills(reserves.annList));
  for (const request of labelRequests) {
    if (request.kind !== 'point') continue;
    const ci = domain.lastIdxOf.get(request.owner.seriesId ?? '');
    if (ci !== undefined && request.owner.categoryId === cats[ci]?.id) {
      request.font = { ...request.font, weight: focusValue && highlights.has(request.owner.seriesId ?? '') ? focusValue.weight : labelFont.weight };
      request.fontStep = request.font;
    }
  }
  // the fan's edge values are point values; valueLabels 'none' and labels.point false print none.
  if (domain.labelModes.values !== 'none' && text.contentOf('point', ['absolute']) !== null) addFanEdgeLabels(domain, area, marks, labelFont, labelH, labelRequests, measure);
  // A tie's shared value reads with its note at the shared point.
  joinTieValues({ bump: domain.bumpDerived, labelRequests, font: text.tickFont, measure });
  const xPartial = xPartialWords(env, domain, area, reserves, lineToDateIds(env, domain, text));
  const catLabelsShown = area.xTicks && area.xOfValue
    ? placeXTickLabels({ show: area.showCategoryTickRow, plan: area.xTicks, xOf: area.xOfValue, row: area.frame.plot,
      bottom: plot.y + plot.h + area.categoryTickGap, plotRight: plot.x + plot.w, plotLeft: plot.x, labelRequests, ...xPartial })
    : placeCategoryLabels({ show: area.showCategoryTickRow, plan: area.catPlan, cats, xOf,
      plot: { ...plot, h: plot.h + area.categoryTickGap - 6 }, labelRequests });
  return { labelRequests, ratioTierRequestState, endpointLeaderAnchors, catLabelsShown, xPartialGroups: xPartial.partial?.groups ?? [], endpointFallback: bounded?.fallback ?? false, endpointWiden: bounded?.widen ?? false };
}

/**
 * A time axis has no category names to carry a running period's words. Where
 * no value prints them (lineToDateIds), they print under the reading on the
 * axis; a running end value that the key carries already says them there.
 */
function xPartialWords(env: LineEnv, domain: LineDomain, area: LineArea, reserves: LineReserves, onValues: ReadonlySet<Id>): { partial?: { at: number[]; names: string[]; text: string; w: number; groups?: string[][] } } {
  const { cats, options } = domain;
  if (!domain.x || !area.xTicks || disclosuresShown(options)) return {};
  const text = options.strings?.toDate ?? chartString(options, 'toDate');
  const shown = cats.flatMap((c, ci) => c.partial === true && !onValues.has(c.id) && !saysToDate(c.label ?? c.id, text)
    && domain.drawnSeries.some((s) => (s.vals[ci]?.v ?? null) !== null && !(reserves.keyValues.has(s.id) && domain.lastIdxOf.get(s.id) === ci))
    ? [{ at: domain.x!.model.xs[ci]!, name: c.label ?? c.id }] : []);
  return shown.length ? { partial: { at: shown.map((item) => item.at), names: shown.map((item) => item.name), text, w: env.measure(text, area.xTicks.font).width } } : {};
}

/**
 * The fan's outer edges print their values at the last point
 * they reach, right of it, so the widest interval reads without the axis.
 */
function addFanEdgeLabels(domain: LineDomain, area: LineArea, marks: LineMarkGeometry['marks'], font: LabelRequest['font'], labelH: number, labelRequests: LabelRequest[], measure: LineEnv['measure']): void {
  if (!marks.fan?.length || fanEdgeInKey(domain)) return;
  const edge = outerFanEdge(domain, marks.fan);
  if (!edge) return;
  const outer = marks.fan[edge.index]!;
  const { ci } = edge;
  for (const [id, value] of [[outer.high, edge.high], [outer.low, edge.low]] as const) {
    const text = domain.fmt(value);
    const w = measure(text, font).width;
    const px = area.xOf(ci);
    const py = area.y(value);
    const categoryId = domain.cats[ci]!.id;
    labelRequests.push({
      id: `fan-edge:${id}`, kind: 'point', owner: { seriesId: id, categoryId }, text, lines: [text], typeRole: 'label', font,
      priority: PRIORITY.extreme,
      candidates: [
        { slot: 'right', rect: { x: px + 6, y: py - labelH / 2, w, h: labelH }, penalty: 0 },
        { slot: id === outer.high ? 'above' : 'below', rect: { x: px - w / 2, y: id === outer.high ? py - labelH - 4 : py + 4, w, h: labelH }, penalty: 1 },
      ],
      anchor: { x: px, y: py },
    });
  }
}

/**
 * A gap bracket runs a guide right from each of its two line ends. The upper
 * end's last value sits just over its guide and the lower end's just under
 * it, beside the ring: both stay level with their points, and neither pushes
 * the other off on a leader.
 */
function seatValuesOffGapGuides(domain: LineDomain, area: LineArea, annotations: readonly Annotation[], labelRequests: LabelRequest[], labelH: number): void {
  const last = domain.cats[domain.cats.length - 1];
  if (!last) return;
  const ci = domain.cats.length - 1;
  for (const pair of gapBracketPairs(annotations, last.id, domain.options.gapFill?.between, (domain.options as { [GAP_BRACKET_REFUSED]?: Id[] })[GAP_BRACKET_REFUSED])) {
    const ends = pair.map((id) => {
      const series = domain.drawnSeries.find((s) => s.id === id);
      const value = series ? domain.pv[domain.rowOf.get(series)!]![ci] : null;
      return series && value !== null && value !== undefined ? { id, py: area.y(value) } : undefined;
    });
    if (!ends[0] || !ends[1] || Math.abs(ends[0].py - ends[1].py) < 1) continue;
    for (const end of ends) {
      const request = labelRequests.find((r) => r.kind === 'point' && r.owner.seriesId === end!.id && r.owner.categoryId === last.id);
      const w = request?.candidates[0]?.rect.w;
      if (!request || w === undefined) continue;
      const over = end!.py < Math.max(ends[0].py, ends[1].py);
      request.candidates = [
        { slot: over ? 'overGuide' : 'underGuide', rect: { x: area.xOf(ci) + 7, y: over ? end!.py - labelH - 2 : end!.py + 2, w, h: labelH }, penalty: -1 },
        ...request.candidates,
      ];
    }
  }
}
