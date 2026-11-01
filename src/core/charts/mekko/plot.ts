import { chartString } from '../../strings/mekko';
/**
 * Mekko phase 1, second half: the paints, the frame (the legend is a
 * layout participant), the column x-edges, the category row and the plot
 * rect with its value scale. The frame is solved here, before the scale,
 * because the plot rect comes out of it.
 */

import { axisTitleAllowed, measureValueAxisWidth, planValueAxisTitle, valueAxisTitleBand } from '../../axis';
import { formatAutomaticPercent } from '../../format';
import { frameTextOptions, normalizeLegendOption, plotHeightAfter, solveFrame, fixedPlotChrome, plotChromeFloor, type FrameInput, type FrameResult, type LegendItemInput, authoredFootnoteCount } from '../../frame';
import { PLOT_FLOOR_PX, plotFloorShare } from '../../sizing';
import { categoryRowTop, hangingLabelReserve, planCategoryRow } from '../../label/categoryRow';
import { fitText } from '../../label/fitText';
import { scenarioLegendKeys } from '../../label/legendFidelity';
import { disclosuresShown } from '../../notes';
import { omittedKey } from '../../seriesIdentity';
import { createOccupiedIndex, type OccupiedIndex } from '../../label/occupied';
import { isDateNumericTickSequence } from '../../label/tickRow';
import { linearScale } from '../../scale';
import { DEFAULT_TARGET, targetFloorsPx } from '../../target';
import type { FontSpec } from '../../text';
import {
  labelsOffKeepsNames,
  canvasMargin,
  effectiveFill,
  markRolePaint,
  paintColor,
  rampSlots,
  seriesPaint as themeSeriesPaint,
  signedFillPaint,
  emphasisWeight,
  mutedMarkPaint,
  panelTypeClass,
  recedingSeriesId,
  recedingRampIds,
  neutralRampPaint,
  typeWidthClass,
} from '../../theme';
import type { Id } from '../../types/cell';
import type { LabelContent, LabelKind, LegendOptions } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import type { CellPattern, MekkoArea, MekkoDomain, MekkoEnv, MekkoPaints, NormSer } from './model';
import { categoryLabelsAndMarks } from '../../footnoteMark';
import { textScaleOf } from '../../typeFloors';
import { resolveSubtitle } from '../../normalize/shared';
import { maxOf, minOf, pushAll } from '../../arrays';

export function mekkoPaints(env: MekkoEnv, domain: MekkoDomain, warnings: LintWarning[]): MekkoPaints {
  const { theme, palette, highlights } = env;
  const { series, mode } = domain;
  const css = (p: Paint): string => paintColor(theme, p);
  // A series with its own paint keeps it; the ramp series skip a step that
  // paints the same colour, so no two series of one chart look alike.
  const slots = rampSlots(theme, series.map((s): Paint | undefined =>
    s.fill ? { css: s.fill } : s.colorRole ? markRolePaint(s.colorRole, true) : highlights.has(s.id) ? { token: 'focus' } : undefined,
  ), palette, series.length > 1 ? { labels: series.map((s) => s.label), warnings } : undefined);
  const receding = recedingSeriesId(series, highlights);
  // Two or more plain series beside a highlight recede on the neutral ramp, strongest to quietest.
  const rampIds = recedingRampIds(series, highlights);
  const base = (s: NormSer, dataIdx: number, scenario = s.scenario): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return markRolePaint(s.colorRole, true);
    if (s.id === receding) return mutedMarkPaint();
    const step = rampIds.indexOf(s.id);
    if (step >= 0) return neutralRampPaint(step, rampIds.length, scenario === 'FC');
    if (series.length === 1) return themeSeriesPaint(dataIdx, palette, s.scenario);
    return themeSeriesPaint(slots[dataIdx] ?? dataIdx, palette);
  };
  const cell: MekkoPaints['cell'] = (s, val, cat, dataIdx, v) => {
    if (val.fill) return { css: val.fill };
    // The Others column keeps each series' own fill, as the key shows
    // it; the column's outline says it is pooled (marks.ts).
    if (highlights.has(cat.id) || highlights.has(s.id)) return { token: 'focus' };
    if (mode === 'bar' && v < 0 && !s.fill && !s.colorRole) return signedFillPaint('bad');
    if (val.scenario) {
      return series.length === 1 ? themeSeriesPaint(dataIdx, palette, val.scenario) : base(s, dataIdx, val.scenario);
    }
    return base(s, dataIdx);
  };
  const pattern: MekkoPaints['pattern'] = (s, val) => {
    const sc = val.scenario ?? s.scenario;
    return sc === 'FC' ? 'hatch45' : sc === 'PL' ? 'outline' : undefined;
  };
  // what the viewer SEES: outline reads as background, hatch as a
  // mostly-background blend — auto-ink must contrast against that
  const inside: MekkoPaints['inside'] = (s, val, cat, dataIdx, v) =>
    effectiveFill(css(cell(s, val, cat, dataIdx, v)), pattern(s, val), theme);
  return { css, base, cell, pattern, inside };
}

/**
 * The legend: one key per series, plus a scenario key for every pattern the
 * CELLS will paint. Scenario is a cell property and a series key can only read
 * the series, so a per-cell `scenario: 'FC'` paints a hatch no series key
 * carries. The one guard not reproduced here is the sub-pixel column check
 * (`colW >= 0.5`), which needs the plot width and therefore the solved frame;
 * a scenario present ONLY inside a column too narrow to paint would put a key
 * on the legend for ink nobody sees.
 */
function mekkoLegend(env: MekkoEnv, domain: MekkoDomain, paints: MekkoPaints): FrameInput['legend'] {
  const { options } = env;
  // A missing or undrawn column keeps its explanation in the key when its disclosure does not print.
  const notDrawn = disclosuresShown(options) ? [] : (options as { [MEKKO_NOT_DRAWN]?: string[] })[MEKKO_NOT_DRAWN] ?? [];
  const omitted = notDrawn.map((text, i) => omittedKey(i === 0 ? '__omitted' : `__omitted:${i}`, text));
  // The widest column names each series in place: no series key is needed.
  if (env.namesInPlace) return omitted.length > 0 && options.legend !== 'none' ? { options: normalizeLegendOption('top'), items: omitted } : undefined;
  // Two or more series are told apart by colour alone, so they
  // get a key row above the plot unless the author sets one or 'none'.
  const position = options.legend ?? (domain.series.length > 1 && domain.mode !== 'bar' || omitted.length > 0 ? 'top' : undefined);
  if (!position || position === 'none' || position === 'auto') return undefined;
  const painted: CellPattern[] = [];
  domain.cats.forEach((_c, ci) => {
    if (domain.invalidAt(ci)) return;
    for (const s of domain.series) {
      const v = domain.plottedAt(s, ci);
      if (v === null || v === 0) continue;
      painted.push(paints.pattern(s, s.vals[ci]!));
    }
  });
  const legendOpts: LegendOptions = normalizeLegendOption(position);
  const seriesItems: LegendItemInput[] = domain.series.map((s, i) => ({
    id: s.id,
    label: s.label,
    paint: paints.base(s, i),
    pattern: s.scenario === 'FC' ? 'hatch45' : s.scenario === 'PL' ? 'outline' : undefined,
  }));
  let items: LegendItemInput[] = [
    ...seriesItems,
    ...scenarioLegendKeys({ markPatterns: painted, keyPatterns: seriesItems.map((item) => item.pattern), paint: { token: 'neutralMark' }, strings: options.strings }),
    ...omitted,
  ];
  if (legendOpts.order) {
    const oi = (id: Id) => {
      const k = legendOpts.order!.indexOf(id);
      return k === -1 ? Number.MAX_SAFE_INTEGER : k;
    };
    items = [...items].sort((a, b) => oi(a.id) - oi(b.id));
  }
  return { options: legendOpts, items };
}

/** Internal: explanations for missing or undrawn columns from the first pass, for the key. */
export const MEKKO_NOT_DRAWN = Symbol('mekkoNotDrawn');

/** The frame, with the legend as a layout participant; it claims into an index of its own. */
export function solveMekkoFrame(
  env: MekkoEnv,
  domain: MekkoDomain,
  paints: MekkoPaints,
): { frame: FrameResult; claims: OccupiedIndex } {
  const { options, theme, size } = env;
  // A value line's label sits over the line inside the plot, end-anchored at
  // its right edge, so only an indicator at the right needs the room.
  const needsRightRoom = (options.annotations ?? []).some((a) => a.kind === 'indicator100' && a.side === 'right');
  // The token margin is the base; the right-hand annotation reserve may only
  // WIDEN it: reserves outrank layout requests and never shrink them.
  const tokenMargin = canvasMargin(theme, size.width);
  const margin = {
    ...tokenMargin,
    right: needsRightRoom ? Math.max(56, tokenMargin.right) : tokenMargin.right,
    ...options.margin,
  };
  const legend = mekkoLegend(env, domain, paints);
  const claims = createOccupiedIndex({ x: 0, y: 0, w: size.width, h: size.height });
  const frame = solveFrame({ size, margin, ...frameTextOptions(options), legend, theme, measure: env.measure }, claims);
  return { frame, claims };
}

/** Whether a label kind is on, and with which content. */
export function kindSetting(env: MekkoEnv, kind: LabelKind): boolean | LabelContent {
  const l = env.options.labels;
  if (l === false) return kind === 'category' && labelsOffKeepsNames(env.options);
  const v = l?.[kind];
  return v === undefined ? true : v;
}

/**
 * The axis reserve and the column x-edges come BEFORE the plot rect: the
 * category band reserves what its measured labels need, and the wrap
 * needs each column's width, which depends only on the final x-extent.
 */
export function mekkoPlotArea(env: MekkoEnv, domain: MekkoDomain, frame: FrameResult, warnings: LintWarning[]): MekkoArea {
  const { theme, measure, va, options } = env;
  const { mode, cats, weights, totalWeight, dLo, dHi } = domain;
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const strongFont: FontSpec = { family: theme.type.family, ...theme.type.label, weight: emphasisWeight(theme) };
  const totalH = measure('0', strongFont).height;
  const hasCagr = (options.annotations ?? []).some((a) => a.kind === 'cagr');
  const catsOnTop = mode === 'percent';
  const showCats = kindSetting(env, 'category') !== false;
  // Shares of an unknown whole print no total, so a chart of only those keeps no totals row.
  const showTotals = kindSetting(env, 'total') !== false && domain.cats.some((c) => !domain.wholeUnknown.has(c.id));
  const axisFmt = mode === 'percent' ? (v: number) => formatAutomaticPercent(v, 0, false, options.locale?.language) : env.fmt;
  // A percent or unit mekko on a small canvas prints every value on its
  // segment (and a unit stack its total above it), so the value axis repeats
  // them and costs the plot its left gutter. A percent chart keeps the axis
  // title, as it names what the shares are; a unit chart's subtitle names
  // the measure and unit.
  const segmentSetting = kindSetting(env, 'segment');
  const valuesPrinted = (part: 'percent' | 'absolute') => segmentSetting === true || (Array.isArray(segmentSetting) && segmentSetting.includes(part));
  const smallCard = va.show === undefined && (panelTypeClass(options) ?? typeWidthClass(env.size.width)) === 'S';
  const compactPercent = smallCard && mode === 'percent' && valuesPrinted('percent');
  const compactUnit = smallCard && mode === 'unit' && showTotals && (valuesPrinted('absolute') || domain.series.length === 1);
  const showAxis = va.show ?? (mode !== 'bar' && !compactPercent && !compactUnit);
  // The value-axis title in the head band, as on column; drawn only when authored.
  const axisTitle = (showAxis || compactPercent) && axisTitleAllowed(options.labels)
    ? planValueAxisTitle(options.axisTitles?.primary, theme, measure, frame.plot.w)
    : undefined;
  // Percent mode: the name and total rows stand between the title and the
  // 100% tick, so the title needs no room of its own for half the tick.
  const axisTitleBand = valueAxisTitleBand(axisTitle, theme, measure, catsOnTop ? measure('0', tickFont).height : 0);
  const axisReserve = showAxis ? measureValueAxisWidth([dLo, dHi], axisFmt, theme, measure) : 0;
  const plotX0 = frame.plot.x + axisReserve;
  const plotWFull = showAxis ? Math.max(10, frame.plot.w - axisReserve) : frame.plot.w;
  // x positions: cumulative widths, no gaps
  const edgesFor = (plotW: number): number[] => {
    const edges: number[] = [plotX0];
    let cumW = 0;
    cats.forEach((_, ci) => {
      cumW += totalWeight > 0 ? weights[ci]! : 1;
      const denom = totalWeight > 0 ? totalWeight : cats.length;
      edges.push(plotX0 + (plotW * cumW) / denom);
    });
    return edges;
  };
  const namedCol = env.namesInPlace ? widestColumn(domain, edgesFor(plotWFull)) : -1;
  const gutter = sharesGutter(env, domain, edgesFor(plotWFull), labelFont, namedCol);
  const plotW0 = Math.max(10, plotWFull - gutter);
  // Bar mode: adjacent same-colour bars meet on whole pixels, so no hairline
  // seam shows at some joints and not at others.
  const xEdge = mode === 'bar' ? edgesFor(plotW0).map((x, i, all) => (i === 0 || i === all.length - 1 ? x : Math.round(x))) : edgesFor(plotW0);
  // Date/numeric ticks are one line on one row; prose wraps to two.
  const last = cats.length - 1;
  // Percent heads: the last column's name and total read over the column and
  // its gutter, and may reach left over a quarter of the neighbour column,
  // up to 16 px, as no head stands right of them (labels.ts headLeft).
  const borrow = catsOnTop && last > 0 ? Math.min(16, (xEdge[last]! - xEdge[last - 1]!) / 4) : 0;
  const headW = (ci: number): number => xEdge[ci + 1]! - xEdge[ci]! + (ci === last ? gutter + borrow : 0);
  const catCenters = cats.map((_, ci) => (ci === last ? xEdge[ci]! - borrow + headW(ci) / 2 : (xEdge[ci]! + xEdge[ci + 1]!) / 2));
  // A zero-width column draws nothing and names nothing (zero-weight-column):
  // it takes no part in the row's pitch or fit.
  const visible = cats.map((_, ci) => xEdge[ci + 1]! - xEdge[ci]! >= 0.5);
  const visibleCenters = catCenters.filter((_, ci) => visible[ci]);
  const catStep = Math.max(
    1,
    visibleCenters.length > 1 ? minOf(visibleCenters.slice(1).map((center, i) => center - visibleCenters[i]!)) : plotW0,
  );
  const row = categoryLabelsAndMarks(cats, { count: authoredFootnoteCount(options), warnings });
  const footnoteFont: FontSpec = { family: theme.type.family, ...theme.type.footnote };
  const rowPlan = (named: readonly boolean[], fonts: FontSpec[] = [tickFont, footnoteFont], widths?: readonly number[], step = catStep) => planCategoryRow({
    ...row,
    labels: row.labels.map((label, ci) => (named[ci] ? label : '')),
    // A blanked name takes no mark seat: a mark alone would count as a name in the row's pitch.
    suffixes: row.suffixes.map((suffix, ci) => (named[ci] ? suffix : '')),
    keep: [...named],
    centers: catCenters,
    step,
    // Columns are as wide as their totals: each name wraps in its own column.
    widths: widths ? [...widths] : cats.map((_, ci) => headW(ci)),
    fonts,
    measure,
    rotate: false,
    target: options.target, textScale: textScaleOf(options),
  });
  let catPlan = rowPlan(visible);
  // A head that needs three lines at the axis size takes the footnote step on
  // two, but only where that step stays on the axis floor.
  const footnoteStepAllowed = footnoteFont.size >= targetFloorsPx(options.target ?? DEFAULT_TARGET, textScaleOf(options)).axis;
  if (catPlan.maxLines > 2 && catPlan.rotation === 0 && footnoteStepAllowed) {
    const stepped = rowPlan(visible, [footnoteFont]);
    if (stepped.maxLines <= 2 && stepped.step !== 'stride' && !stepped.infos.some((info) => info.truncated)) catPlan = stepped;
  }
  // A stride would pick names by position and could leave a wide column
  // unnamed while narrower columns keep theirs. Each column keeps its name
  // where it fits whole in its own width, on up to two lines; the rest are
  // named in a note, left to right (layout.ts).
  // The engine's own date labels make a date row whatever their words (catPlan.dateNumeric).
  const dateNumericTicks = catPlan.dateNumeric || isDateNumericTickSequence(cats.map((c) => c.label ?? c.id));
  let unnamed: number[] = [];
  let namePack: NamePack | undefined;
  if (showCats && catPlan.step === 'stride' && !dateNumericTicks && !catsOnTop) {
    // Unit and bar: a name under the plot may reach over a neighbour's free
    // space and ends at the plot edges; a name that meets its left
    // neighbour's takes a second tier. Only a name with no room on either
    // tier goes to the note.
    namePack = packNames(env, domain, { labels: row.labels, font: tickFont, centers: catCenters, colLeft: xEdge.slice(0, -1), colRight: xEdge.slice(1), visible, lo: plotX0, hi: plotX0 + plotW0 });
    // The pack has placed every name, on its tier: the row plan only sets each
    // name's lines, so it sees a step no name overlaps and keeps them all.
    const packed = rowPlan(namePack.row.map((r) => r >= 0), [tickFont], namePack.width.map((w, ci) => Math.max(w + 2, headW(ci))), plotW0 + Math.max(0, maxOf(namePack.width)));
    // The row plan's own one-row stride does not see the tiers; the pack decides which names draw.
    catPlan = { ...packed, keep: namePack.row.map((r) => r >= 0), warnings: packed.warnings.filter((warning) => warning.code !== 'category-stride') };
    unnamed = cats.flatMap((_, ci) => (visible[ci] && !catPlan.keep[ci] ? [ci] : []));
  } else if (showCats && catPlan.step === 'stride' && !dateNumericTicks) {
    const fits = cats.map((_, ci) => visible[ci]! &&
      fitText(row.labels[ci]!, tickFont, Math.max(1, headW(ci) - 6), 2, measure, { target: options.target, textScale: textScaleOf(options), typeRole: 'axis' }).title === undefined);
    catPlan = rowPlan(fits);
    // The plan keeps the last column's blank name; a name that was blanked is unnamed.
    catPlan = { ...catPlan, keep: catPlan.keep.map((kept, ci) => kept && fits[ci]!) };
    unnamed = cats.flatMap((_, ci) => (visible[ci] && !catPlan.keep[ci] ? [ci] : []));
    if (catsOnTop && unnamed.length > 0) {
      // Percent: a name that does not fit its column takes a second tier over the first, on one line, with a leader to its column.
      const font = catPlan.font;
      const texts = row.labels.map((label, ci) => `${label}${row.suffixes[ci]}`);
      const tier = packNames(env, domain, { labels: texts, font, centers: catCenters, colLeft: xEdge.slice(0, -1), colRight: xEdge.slice(1), visible: cats.map((_, ci) => unnamed.includes(ci)), lo: plotX0, hi: plotX0 + plotW0 + gutter }, 1);
      const seated = unnamed.filter((ci) => tier.row[ci]! >= 0);
      if (seated.length > 0) {
        const lineH = font.size * (font.lineHeight ?? 1.2);
        namePack = { ...tier, row: cats.map((_, ci) => (seated.includes(ci) ? 1 : unnamed.includes(ci) ? -1 : 0)) };
        catPlan = {
          ...catPlan,
          rowHeight: Math.max(catPlan.rowHeight, lineH),
          keep: catPlan.keep.map((kept, ci) => kept || seated.includes(ci)),
          infos: catPlan.infos.map((info, ci) => (seated.includes(ci) ? { lines: [texts[ci]!], w: tier.width[ci]!, h: lineH, truncated: false } : info)),
        };
        unnamed = unnamed.filter((ci) => !seated.includes(ci));
      }
    }
  }
  if (showCats) pushAll(warnings, catPlan.warnings);
  // A width series prints each column's width as a line under its name:
  // the widths are the chart's second measure, and unprinted they would have
  // to be estimated from the column edges. The first width names its series, as
  // the first box names its median. A rotated row keeps names only.
  const widthSer = domain.widthSer;
  const widthValues = widthSer && showCats && catPlan.rotation === 0
    ? cats.map((_, ci) => (visible[ci] ? widthSer.vals[ci]?.v ?? null : null))
    : undefined;
  const firstWidth = widthValues?.findIndex((v) => v !== null) ?? -1;
  // A width series that declares its unit is titled once, name
  // and unit, under the row; the first width then carries no name of its own.
  const widthTitled = widthValues !== undefined && widthSer!.unit !== undefined && !catsOnTop;
  // The subtitle that already names the width measure and its unit ("width:
  // revenue in €bn") makes the caption a repeat, so it is not drawn.
  const subtitleText = Object.values(resolveSubtitle(options.subtitle) ?? {}).flat().filter((part): part is string => typeof part === 'string').join(' ').toLowerCase();
  const captionShown = widthTitled && !(subtitleText.includes(widthSer!.label.toLowerCase()) && subtitleText.includes(widthSer!.unit!.toLowerCase()));
  const widthTexts = widthValues?.map((v, ci) =>
    v === null ? '' : `${ci === firstWidth && !widthTitled ? `${widthSer!.label} ` : ''}${env.widthFmt(v)}`);
  // The width line takes the row font's own line height.
  const widthLineH = widthTexts ? catPlan.font.size * (catPlan.font.lineHeight ?? 1.2) : 0;
  // The caption wraps to two lines within the plot before it is cut; the row reserves its measured height.
  const widthTitleText = captionShown ? chartString(env.options, 'widthTitle', { v1: widthSer!.label, v2: widthSer!.unit }) : undefined;
  // The caption starts at the frame's left edge and may use its whole width (labels.ts).
  const widthTitlePlan = planValueAxisTitle(widthTitleText, theme, measure, frame.plot.w, 2);
  const widthTitleH = widthTitlePlan ? widthTitlePlan.height + 4 : 0;
  // A second tier of names takes one more row of name and width.
  const tierH = namePack?.row.includes(1) ? catPlan.rowHeight + widthLineH + (catsOnTop ? UPPER_TIER_GAP : 2) : 0;
  const categoryTickReserve = showCats ? catPlan.rowHeight + widthLineH + tierH + widthTitleH + (catsOnTop ? 4 : 8) : 0;
  // percent: name (≤2 lines) + bold total stacked above the 100% edge;
  // unit/bar: totals float above varying column tops (headroom already in domain)
  const topPad =
    8 +
    axisTitleBand +
    (hasCagr ? 30 : 0) +
    (catsOnTop ? categoryTickReserve + (showTotals ? totalH + 4 : 0) : showTotals ? totalH + 6 : 0);
  const catBandH = !catsOnTop && showCats ? categoryTickReserve : 4;
  // A negative total hangs under its column; the category row goes under the
  // lowest of them, so the plot makes room for that label.
  const hanging = !catsOnTop && showCats && showTotals
    ? cats.flatMap((c, ci) => ((mode === 'bar' ? domain.negBot[ci]! : domain.columnTotals[c.id]!) < 0 ? [domain.negBot[ci]!] : []))
    : [];
  const hangingEnd = hanging.length ? minOf(hanging) : undefined;
  const plotH0 = frame.plot.h - catBandH - topPad;
  const hangingReserve = hangingLabelReserve(plotH0, [dLo, dHi], hangingEnd, totalH + 4);
  // In unit mode the totals over the varying column tops are read
  // with the columns, so their headroom counts toward the plot floor, not the
  // chrome, where the half-canvas share would double it. A narrow card keeps
  // the 0.4 share and the full plot its values need.
  const halfShare = plotFloorShare(env.size.width, options) >= 0.5;
  const headroom = halfShare && mode === 'unit' && !catsOnTop && showTotals ? totalH + 6 : 0;
  // The category plan does not rotate; solve the negative total's shrinking reserve at the floor.
  fixedPlotChrome(frame, catBandH + topPad - headroom);
  const chrome = plotChromeFloor.get(frame.frame);
  if (chrome !== undefined && hangingEnd !== undefined && hangingEnd < 0) {
    const share = dHi > dLo ? (hangingEnd - dLo) / (dHi - dLo) : 0;
    const room = totalH + 4;
    const floor = PLOT_FLOOR_PX[options.target ?? DEFAULT_TARGET];
    const PLOT_FLOOR_SHARE = plotFloorShare(env.size.width, options);
    const height = Math.max(chrome + floor, chrome + room + (1 - share) * floor,
      chrome / (1 - PLOT_FLOOR_SHARE), (chrome + room) / (1 - PLOT_FLOOR_SHARE + PLOT_FLOOR_SHARE * share));
    if (share >= 0 && share < 1 && Number.isFinite(height)) {
      fixedPlotChrome(frame, catBandH + topPad - headroom + hangingLabelReserve(height - chrome, [dLo, dHi], hangingEnd, room));
    } else plotChromeFloor.delete(frame.frame);
  }
  const plotH = plotHeightAfter(frame, env.size.height, plotH0 - hangingReserve);
  // the plot keeps room for four value lines (or one per series) in a
  // column, so a short automatic frame grows instead of flattening the columns
  // under the larger type.
  const need = Math.max(4, domain.series.length) * (totalH + 4);
  frame.frame.plotMinHeight = Math.max(frame.frame.plotMinHeight ?? 0, env.size.height + (frame.deficit ?? 0) - (plotH0 - hangingReserve) + need);
  const plot = {
    x: showAxis ? frame.plot.x + axisReserve : frame.plot.x,
    y: frame.plot.y + topPad,
    w: plotW0,
    h: plotH,
  };
  const y = linearScale([dLo, dHi], [plot.y + plot.h, plot.y]);
  const catRowY = (dateNumericTicks ? plot.y + plot.h + hangingReserve : categoryRowTop(y, Math.min(0, minOf(domain.negBot)), hangingEnd, totalH + 4)) + 6;
  return {
    frame,
    plot,
    floorPlot: headroom > 0 ? { ...plot, y: plot.y - headroom, h: plot.h + headroom } : plot,
    y,
    y0: y(0),
    tickFont,
    labelFont,
    strongFont,
    totalH,
    catsOnTop,
    showCats,
    showTotals,
    showAxis,
    axisFmt,
    xEdge,
    dateNumericTicks,
    catPlan,
    categoryTickReserve,
    // A date row pins to the plot's bottom band; prose reads under the
    // lowest column and its hanging total.
    catRowY,
    topPad,
    axisTitle,
    axisTitleBand,
    widthTexts,
    widthLineH,
    ...(widthTitleText ? { widthTitle: { text: widthTitleText, y: catRowY + catPlan.rowHeight + widthLineH + tierH + 4 } } : {}),
    unnamed,
    ...(namePack ? { namePack } : {}),
    namedCol,
    gutter,
  };
}

/** Where each packed name under the plot goes: its left edge, its tier (0, 1, or -1 for the note) and its width. */
interface NamePack { left: number[]; row: number[]; width: number[] }

/** The gap a packed name keeps to its neighbour on the same tier. */
const NAME_GAP = 6;

/** At most this many names are packed by search; more take the left-to-right pass alone. */
const PACK_SEARCH_MAX = 12;

/**
 * Names under a unit or bar mekko.
 * A name may slide sideways while its centre stays over its own column, and
 * it stays inside the plot's edges (a name wider than an edge column keeps
 * its clamped seat). The names sit on one or two tiers, NAME_GAP apart on a
 * tier. The search tries every tier assignment and keeps the one that names
 * the most columns, then puts the fewest on the second tier, then keeps the
 * first name on the first tier, then moves the names least from their centres. A name with no seat goes to the note. The
 * width includes the column's width value under the name.
 */
function packNames(
  env: MekkoEnv,
  domain: MekkoDomain,
  row: { labels: readonly string[]; font: FontSpec; centers: readonly number[]; colLeft: readonly number[]; colRight: readonly number[]; visible: readonly boolean[]; lo: number; hi: number },
  tiers: 1 | 2 = 2,
): NamePack {
  const widthSer = domain.widthSer;
  const width = domain.cats.map((_, ci) => {
    const nameW = Math.max(0, ...row.labels[ci]!.split('\n').map((line) => env.measure(line, row.font).width));
    const v = widthSer?.vals[ci]?.v;
    // The first width names its series unless a caption titles the widths.
    const named = widthSer?.unit === undefined && ci === widthSer?.vals.findIndex((cell) => cell?.v !== null && cell?.v !== undefined);
    const valueW = v === null || v === undefined ? 0 : env.measure(`${named ? `${widthSer!.label} ` : ''}${env.widthFmt(v)}`, row.font).width;
    return Math.max(nameW, valueW);
  });
  const drawn = domain.cats.map((_, ci) => row.visible[ci]! && width[ci]! > 0 && width[ci]! <= row.hi - row.lo);
  const centred = width.map((w, ci) => Math.max(row.lo, Math.min(row.centers[ci]! - w / 2, row.hi - w)));
  // The seats a name may take: centre over its own column, inside the plot.
  const minL = width.map((w, ci) => Math.max(row.lo, row.colLeft[ci]! - w / 2));
  const maxL = width.map((w, ci) => Math.min(row.hi - w, row.colRight[ci]! - w / 2));
  const order = domain.cats.map((_, ci) => ci).filter((ci) => drawn[ci]);
  const place = (tierOf: (k: number) => number): { pack: NamePack; score: number[] } => {
    const lastRight = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const left = [...centred];
    const tier = domain.cats.map(() => -1);
    let moved = 0;
    order.forEach((ci, k) => {
      const t = tierOf(k);
      const lo = minL[ci]! <= maxL[ci]! ? minL[ci]! : centred[ci]!;
      const hi = minL[ci]! <= maxL[ci]! ? maxL[ci]! : centred[ci]!;
      const at = Math.max(Math.min(Math.max(centred[ci]!, lo), hi), lastRight[t]! + NAME_GAP);
      if (at > hi + 0.01) return;
      tier[ci] = t;
      left[ci] = at;
      lastRight[t] = at + width[ci]!;
      moved += Math.abs(at - centred[ci]!);
    });
    const unnamed = order.filter((ci) => tier[ci]! < 0).length;
    // The reader starts at the left: the first name stays on the first tier when it can.
    const firstLow = order.length > 0 && tier[order[0]!] === 1 ? 1 : 0;
    return { pack: { left, row: tier, width }, score: [unnamed, tier.filter((t) => t === 1).length, firstLow, moved] };
  };
  const better = (a: number[], b: number[]): boolean => {
    const k = a.findIndex((v, i) => Math.abs(v - b[i]!) > 0.01);
    return k >= 0 && a[k]! < b[k]!;
  };
  if (tiers === 1) return place(() => 0).pack;
  // Left to right, a name takes the first tier with room.
  const lastRight = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let best = place((k) => {
    const ci = order[k]!;
    const hi = minL[ci]! <= maxL[ci]! ? maxL[ci]! : centred[ci]!;
    const t = lastRight.findIndex((right) => Math.max(centred[ci]!, right + NAME_GAP) <= hi + 0.01);
    const at = t < 0 ? 0 : t;
    lastRight[at] = Math.max(centred[ci]!, lastRight[at]! + NAME_GAP) + width[ci]!;
    return at;
  });
  if (order.length <= PACK_SEARCH_MAX) {
    for (let mask = 0; mask < 1 << order.length; mask++) {
      const tried = place((k) => (mask >> k) & 1);
      if (better(tried.score, best.score)) best = tried;
    }
  }
  return best.pack;
}

/** The widest drawn column that can hold shares, or -1: its segment labels name their series. */
function widestColumn(domain: MekkoDomain, edges: readonly number[]): number {
  let best = -1;
  domain.cats.forEach((_, ci) => {
    if (domain.invalidAt(ci) || domain.incomplete.has(domain.cats[ci]!.id)) return;
    const w = edges[ci + 1]! - edges[ci]!;
    if (best < 0 || w > edges[best + 1]! - edges[best]! + 0.5) best = ci;
  });
  return best;
}

/**
 * A percent mekko's last column narrower than its shares (LatAm, 2% of the
 * market) would hide every one of them. The plot gives up a gutter on its
 * right, and the shares sit there, beside their segments. 0 when the
 * column holds its shares, or for any other mode.
 */
function sharesGutter(env: MekkoEnv, domain: MekkoDomain, edges: readonly number[], font: FontSpec, namedCol: number): number {
  const ci = domain.cats.length - 1;
  if (domain.mode !== 'percent' || ci < 1 || ci === namedCol || domain.invalidAt(ci) || domain.incomplete.has(domain.cats[ci]!.id)) return 0;
  if (kindSetting(env, 'segment') !== true) return 0;
  const w = edges[ci + 1]! - edges[ci]!;
  if (w < 0.5) return 0;
  const c = domain.cats[ci]!;
  const widest = Math.max(0, maxOf(domain.series.map((s) => {
    const v = domain.plottedAt(s, ci);
    if (v === null || v === 0) return 0;
    return env.measure(domain.shareTexts.get(`${c.id}\0${s.id}`) ?? env.pctFmt(v), font).width;
  })));
  return widest + 4 <= w || widest === 0 ? 0 : Math.ceil(widest + GUTTER_GAP + 4);
}

/** The air between a percent mekko's first tier of names and the second tier over it. */
export const UPPER_TIER_GAP = 3;

/** The air between the narrow last column and its shares in the gutter. */
export const GUTTER_GAP = 5;
