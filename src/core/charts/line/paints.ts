import { DENSE_CATEGORY_COUNT } from '../../denseCharts';
import { planLineStyle } from '../../planLineStyle';
import { PALETTE_NORMAL_FLOOR, palettePerceptualDistance } from '../../themeRules';
import { forecastStroke } from './forecast';
/**
 * Line phase 1, paints: the hero and context ladder, the bump
 * identity channels, the fan ladder, dashes, markers and the label-kind
 * gates. One decision per series, shared by legend, marks and labels.
 */

import { withUnit } from '../../unitJoin';
import { distinctDecimalLift, MAX_FORMAT_DECIMALS, shareDecimals } from '../../formatPrecision';
import { formatAutomaticPercent } from '../../format';
import { formatWithSpec, seriesRasterFormatter } from '../../formatSpec';
import { NormalizeError } from '../../normalize/shared';
import { DEFAULT_OTHERS_SHADE } from '../../othersShade';
import { othersShadeUnavailableWarnings } from '../../paintWarnings';
import { bumpStoryPaints } from '../../colorRecipes';
import { dashToken, strokeToken, labelsOffKeepsNames, markRolePaint, markRoleToken, mixedPaint, orderedRampPaint, paintColor, rampSlots, secondaryFont, seriesPaint as themeSeriesPaint } from '../../theme';
import type { Id, Scenario } from '../../types/cell';
import type { MarkerShape } from '../../types/data';
import type { LabelContent, LabelKind } from '../../types/options';
import type { LintWarning, Paint } from '../../types/scene';
import type { NormSer } from './context';
import { buildFanPaints } from './fan';
import type { FontSpec } from '../../text';
import type { LineBandRule, LineDomain, LineEnv, LinePaints, LineText } from './model';
import { pushAll } from '../../arrays';

/** Default marker cutoff: more categories than this ⇒ markers off. */
export const MARKER_MAX_CATS = DENSE_CATEGORY_COUNT;
const BUMP_SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond'];
const BUMP_DASH_ROLES = [undefined, 'reference', 'dotted'] as const;
/**
 * De-emphasised context lines share ONE neutralLight, so three of them ending
 * on the same pixel are three identical strokes with three labels nobody can
 * attribute. The ladder keeps
 * the muted hierarchy but steps each context stroke toward ink so the reader
 * can match label swatch to line. Toward INK, not background: every rung then
 * has at least neutralLight's contrast, on dark grounds too.
 */
const CONTEXT_LADDER_INK_SHARE = [0, 0.25, 0.45, 0.6, 0.72];
/**
 * The context lines of a plain line
 * chart under a grey highlight keep at least 3:1 against the page, forecast
 * segments included, and differ by lightness and marker shape. The first
 * context line takes the darker rung; the circle stays the highlight's.
 */
const LINE_GREY_LADDER_INK_SHARE = [0.65, 0.4, 0.78, 0.52];
const LINE_GREY_SHAPES: MarkerShape[] = ['square', 'diamond', 'triangle'];
/** How far highlightMode 'fade' washes a non-highlighted series toward the page. */
const HIGHLIGHT_FADE = 0.5;
/** The light-page mark floor: a faded series still reads against the page. */
const FADE_PAGE_FLOOR = 1.4;
const fadedPaint = (paint: Paint): Paint => {
  const mixed = mixedPaint(paint, { token: 'background' }, HIGHLIGHT_FADE, 'token' in paint ? paint.token : 'neutralLight');
  return 'theme' in mixed && mixed.theme?.kind === 'mix' ? { ...mixed, theme: { ...mixed.theme, pageFloor: FADE_PAGE_FLOOR } } : mixed;
};

/** The label-kind gates and the text composer every label path shares. */
export function lineText(env: LineEnv, domain: LineDomain): LineText {
  const { options, valueSpec, fmt } = domain;
  const kindSetting = (kind: LabelKind): boolean | LabelContent => {
    const l = options.labels;
    if (l === false) return kind === 'category' && labelsOffKeepsNames(options);
    const v = l?.[kind];
    return v === undefined ? true : v;
  };
  const contentOf = (kind: LabelKind, dflt: LabelContent): LabelContent | null => {
    const s = kindSetting(kind);
    if (s === false) return null;
    return Array.isArray(s) ? s : dflt;
  };
  // `unitSuffix` belongs to the number, so it is appended to the formatted
  // absolute value here rather than to the joined string. Appending it at the
  // end read as "25.80 Searchm" whenever the content put the value first.
  // The join is the hover card's: a sign or a magnitude letter
  // sits on the number ("54m", "$54m", "54%"), a word unit after a space
  // ("54 USD m"). Glued, a word unit read "54USD m".
  const compose = (extra: number): LineText['composeText'] => (content, abs, pct, catLabel, serLabel, unitSuffix = '', authoredPct = false, source, categoryId) => {
    const parts: string[] = [];
    const shareText = !authoredPct && source && categoryId !== undefined ? domain.shareTexts.get(`${categoryId}\0${source.id}`) : undefined;
    const lifted = (value: number, percent: boolean): string => {
      const spec = seriesRasterFormatter(source?.format ?? options.format, domain.seriesNorm.flatMap(s => s.vals.map(v => v.v)), options.locale?.language, source?.unit ?? options.unit, options.target).spec;
      return formatWithSpec(value, { ...spec, decimals: Math.min(MAX_FORMAT_DECIMALS, spec.decimals + extra),
        wholeFrom: undefined, currencyWhole: undefined, ...(percent && !source?.format && !options.format ? { suffix: '%' } : {}) });
    };
    for (const c of content) {
      // An authored percent cell keeps its '%' on the value; a rebased index has no source.
      if (c === 'absolute' && abs !== null) parts.push(withUnit(extra ? lifted(abs, authoredPct) : (authoredPct && source && !source.format ? valueSpec.fmtPercent : source ? valueSpec.forSeries(source) : fmt)(abs), unitSuffix, true));
      // A share lifts its own percent precision; the chart's number format does not apply to it.
      else if (c === 'percent' && pct !== null) parts.push(shareText ?? (extra
        ? formatAutomaticPercent(pct, Math.min(MAX_FORMAT_DECIMALS, (authoredPct ? Math.abs(pct) < 1 && pct !== 0 ? 1 : 0 : shareDecimals(pct)) + extra), false, options.locale?.language)
        : authoredPct ? env.authoredPctFmt(pct) : env.pctFmt(pct)));
      else if (c === 'category' && catLabel) parts.push(catLabel);
      else if (c === 'series' && serLabel) parts.push(serLabel);
    }
    return parts.join(' ');
  };
  const composeText = compose(0);
  const endExtra = env.isBump ? 0 : distinctDecimalLift(domain.drawnSeries.flatMap(series => {
    const ci = domain.lastIdxOf.get(series.id);
    if (ci === undefined) return [];
    if (domain.shareTexts.has(`${domain.cats[ci]!.id}\0${series.id}`)) return [];
    // stacked100-area end labels print the share, so the lift compares shares.
    const share = domain.variant === 'stacked100-area';
    const value = share ? domain.endpoints[series.id]?.value ?? null : domain.rebased ? domain.pv[domain.rowOf.get(series)!]![ci]! : domain.absOf(series, ci);
    if (value === null) return [];
    const cell = series.vals[ci]!;
    const source = domain.rebased ? undefined : cell.format ? { ...series, format: cell.format } : series;
    return [{ value, format: (extra: number) => compose(extra)(share ? ['percent'] : ['absolute'], value, value, '', '', '', cell.isPct, source) }];
  }));
  const composeEndText = endExtra ? compose(endExtra) : composeText;
  // The raster prints no nonzero value as 0, so the near-zero group asks the
  // formatter composeText picks whether the raw value is zero at its precision.
  const printsZero: LineText['printsZero'] = (abs, authoredPct = false, source) =>
    valueSpec.roundsToZeroAt(abs, authoredPct && source && !source.format ? {} : source);
  const { theme, measure } = env;
  const tickFont: FontSpec = { family: theme.type.family, ...theme.type.axis };
  const labelFont: FontSpec = { family: theme.type.family, ...theme.type.label };
  const nameFont = labelFont;
  return { kindSetting, contentOf, composeText, composeEndText, printsZero, tickFont, secondaryFont: secondaryFont(theme), labelFont, nameFont, labelH: measure('0', labelFont).height };
}

/**
 * Hero line (notation rule: >3 intersecting lines confuse; consulting style:
 * ONE hero line + muted context). It is right for one line against context
 * and wrong for peers, so it is opt-in: `emphasis: 'first'`. A drawn fan is the exception: its centre is the subject
 * by construction, so a fan keeps the hero unless the author sets
 * `emphasis: 'none'`. Any highlight/palette/fill/colorRole/scenario keeps peer
 * mode, and bump opts out: on a rank chart every entity is a competitor.
 *
 * WITH A FAN, THE CENTRE IS THE HERO — always, whatever order the author
 * listed data.series in. A fan is an exhibit ABOUT its centre; a comparator
 * listed first must not take the ink while the central trajectory washes out
 * with the tint ladder.
 */
function heroPlan(env: LineEnv, domain: LineDomain, warnings: LintWarning[]): { heroMode: boolean; heroId: Id | null } {
  const { drawnSeries, fan, variant, options } = domain;
  const activeFan = fan !== null && fan !== undefined && fan.origin !== null;
  const emphasis = options.emphasis ?? (activeFan ? 'first' : 'none');
  const heroEligible =
    !env.isBump &&
    variant === 'line' &&
    // An active fan's centre is the subject even as the only drawn line (the
    // bounds are not in drawnSeries), so it stays eligible.
    (drawnSeries.length >= 2 || activeFan) &&
    !env.anyHighlight &&
    !env.paletteRamp &&
    drawnSeries.every((s) => !s.fill && !s.colorRole && !s.scenario);
  const heroMode = emphasis === 'first' && heroEligible;
  if (options.emphasis === 'first' && !heroMode) {
    warnings.push({
      code: 'line-emphasis-ignored',
      severity: 'warn',
      message:
        "emphasis 'first' needs two or more plain lines; a single drawn series, a highlight, palette, series fill, colorRole or series-level scenario, or an area or bump variant keeps its own colours",
      suggest: "remove emphasis, or use highlight to pick the series that leads",
    });
  }
  const heroId = heroMode ? (fan && fan.origin !== null ? fan.of.id : drawnSeries[0]!.id) : null;
  // Not on bump: many peers IS the exhibit there, and "highlight one series"
  // would be advice to stop asking who overtook whom.
  if (!env.isBump && variant === 'line' && !heroMode && !env.anyHighlight && drawnSeries.length > 3) {
    warnings.push({
      code: 'line-peer-overload',
      severity: 'info',
      message: `${drawnSeries.length} peer-styled lines are hard to follow — highlight one series, set emphasis 'first', or facet into small multiples (grid repeat)`,
    });
  }
  return { heroMode, heroId };
}

/**
 * BUMP IDENTITY IS A PAIR: (ramp colour, marker shape). On a rank chart the
 * line IS the entity, and a 6-wide ramp that repeats its last colour made the
 * 7th entity onward one colour. So colour cycles (`dataIdx % rampLen`) and the
 * WRAP INDEX picks the marker shape, then the line style; past
 * `rampLen * shapes * dashes` the triple repeats, so the chart REFUSES
 * (`bump-identity-exhausted`), like pie's `pie-ramp-crowded` measures its own
 * ramp. An author's `series[].fill` or `series[].marker` always wins.
 */
function bumpIdentity(env: LineEnv, domain: LineDomain, warnings: LintWarning[]) {
  const bumpRampLen = Math.max(1, (env.paletteRamp ?? env.theme.color.series).length);
  const slot = (dataIdx: number): { color: number; shape: MarkerShape; dash: number[] | undefined } => {
    const shapeWrap = Math.floor(dataIdx / bumpRampLen);
    const dashRole = BUMP_DASH_ROLES[Math.floor(shapeWrap / BUMP_SHAPES.length) % BUMP_DASH_ROLES.length];
    return {
      color: dataIdx % bumpRampLen,
      shape: BUMP_SHAPES[shapeWrap % BUMP_SHAPES.length]!,
      dash: dashRole ? dashToken(env.theme, dashRole) : undefined,
    };
  };
  if (!env.isBump) return slot;
  const capacity = bumpRampLen * BUMP_SHAPES.length * BUMP_DASH_ROLES.length;
  const autoIdentity = domain.dataSeries.filter((s) => !s.fill).length;
  if (autoIdentity > capacity) {
    throw new NormalizeError(
      'bump-identity-exhausted',
      'series',
      `${autoIdentity} entities exceed the ${capacity} distinguishable identities theme '${env.theme.name}' can give a rank line ` +
        `(${bumpRampLen} ramp colours x ${BUMP_SHAPES.length} marker shapes x ${BUMP_DASH_ROLES.length} line styles) — past that two entities ` +
        `would be drawn identically and a crossing between them could not be read at all`,
      'rank fewer entities, give the extra series an explicit `fill`, or facet into small multiples with grid repeat',
    );
  }
  if (autoIdentity > bumpRampLen) {
    const channels = autoIdentity > bumpRampLen * BUMP_SHAPES.length ? 'the TRIPLE (colour, marker shape, line style)' : 'the PAIR (colour, marker shape)';
    warnings.push({
      code: 'bump-identity-crowded',
      severity: 'info',
      message:
        `${autoIdentity} entities exceed the ${bumpRampLen}-colour ramp — identity is ${channels} from entity ${bumpRampLen + 1} on, ` +
        `so two lines of the same colour are told apart by their markers`,
    });
  }
  return slot;
}

/**
 * A bump chart with a highlight tells its story lines from each other and
 * quiets the rest. The first highlight takes the focus, the second the mark
 * ink (blue and navy on boardroom); a third and later one takes its own
 * palette colour, kept as a bump-story recipe because the choice reads the theme. Every
 * other line is one flat neutralLight at the mark stroke with no marker: on a
 * rank chart the context is the field, and a ladder of greys read as eight
 * more stories. highlightMode 'fade' keeps its own rule.
 */
function bumpStoryPaintsOf(env: LineEnv, domain: LineDomain, grey: boolean):
  { paintOf: (id: Id) => Paint; isContext: (s: NormSer) => boolean } | undefined {
  if (!env.isBump || !env.anyHighlight || !grey) return undefined;
  const story = [...env.highlights].filter((id) => domain.drawnSeries.some((s) => s.id === id));
  if (story.length === 0) return undefined;
  const paints = bumpStoryPaints(env.theme, Math.min(story.length, 2));
  return {
    paintOf: (id) => {
      const index = story.indexOf(id);
      if (index < 0) return { token: 'neutralLight' };
      if (index < 2) return paints[index]!;
      const paint: Paint = { token: 'focus', theme: { kind: 'bump-story', index, count: story.length } };
      paintColor(env.theme, paint);
      return paint;
    },
    isContext: (s) => !env.highlights.has(s.id) && !s.colorRole && !s.fill,
  };
}

/** Phase 1, paints: every stroke, fill, dash and marker decision. */
export function linePaints(env: LineEnv, domain: LineDomain, warnings: LintWarning[]): LinePaints {
  const { theme, highlights, anyHighlight, isBump, paletteRamp } = env;
  const { options, cats, drawnSeries, dataSeries, isStacked, isArea, pv, rowOf } = domain;
  const palette = paletteRamp ? options.palette : undefined;
  // highlightMode 'fade': the other series keep their own colour, washed toward the page; no grey ladder, no focus colour.
  const fade = anyHighlight && options.highlightMode === 'fade';
  // A line whose colorRole is 'highlight' is an authored focus too, so
  // the plain lines step back to the grey ladder as under options.highlight.
  const grey = (anyHighlight || drawnSeries.some((s) => !s.fill && s.colorRole === 'highlight')) && !fade;
  const faded = (paint: Paint, s: NormSer): Paint =>
    fade && !highlights.has(s.id) ? fadedPaint(paint) : paint;
  const css = (paint: Paint): string => paintColor(theme, paint);
  const markersOff = theme.marks?.lineMarkers === 'none';
  const paintCategoryIndex = new Map(cats.map((category, index) => [category.id, index] as const));
  const shadedBandRanges = (options.annotations ?? []).flatMap((annotation) => {
    if (annotation.kind !== 'band' || (annotation.style ?? 'shade') !== 'shade') return [];
    if (annotation.from === undefined || annotation.to === undefined) return [];
    const from = paintCategoryIndex.get(annotation.from);
    const to = paintCategoryIndex.get(annotation.to);
    return from === undefined || to === undefined ? [] : [[Math.min(from, to), Math.max(from, to)] as const];
  });
  const seriesCrossesShadedBand = (series: NormSer): boolean => {
    if (shadedBandRanges.length === 0) return false;
    if (isStacked) return true;
    const indices = pv[rowOf.get(series)!]!.flatMap((value, index) => (value === null ? [] : [index]));
    if (indices.some((index) => shadedBandRanges.some(([from, to]) => index >= from && index <= to))) return true;
    for (let position = 1; position < indices.length; position++) {
      const left = indices[position - 1]!;
      const right = indices[position]!;
      if (!series.interpolateGaps && right !== left + 1) continue;
      if (shadedBandRanges.some(([from, to]) => left <= to && right >= from)) return true;
    }
    return false;
  };
  const bandRules = new Map<Id, LineBandRule>();
  const shadeSafeStroke = (paint: Paint, series: NormSer, authored: Paint = paint): Paint => {
    if (!seriesCrossesShadedBand(series)) return paint;
    const authoredSource = series.fill ? 'fill' : anyHighlight && highlights.has(series.id) ? 'highlight' : null;
    const source = { kind: 'line-band' as const, base: paint, seriesId: series.id };
    const result: Paint = { token: 'token' in paint ? paint.token : 'inkMuted', theme: source };
    css(result); // Refuses only when no mix toward markInk reaches the band floor.
    if (authoredSource) bandRules.set(series.id, { kind: 'line-band-authored-contrast', base: paint, seriesId: series.id, authoredSource, ...(authored !== paint ? { authored } : {}) });
    return result;
  };
  /**
   * An unstacked area fills one series, the lead, when it draws several. Every
   * fill reaches down to the baseline, so a later opaque fill hides the parts
   * of an earlier one under it, and the part that still shows reads as a
   * stacked band (a 124 over a 96 reads as 28). The lead is the first
   * highlighted series, else the first drawn one; the others are plain lines on top.
   */
  const areaLead = isArea && !isStacked && drawnSeries.length > 1
    ? drawnSeries.find((s) => highlights.has(s.id) || s.colorRole === 'highlight') ?? drawnSeries[0]!
    : undefined;
  if (areaLead) warnings.push({
    code: 'line-area-lead',
    severity: 'info',
    message: `the area variant fills one series when it draws several, so no fill hides another or reads as a stacked band: '${areaLead.label}' is filled and the other ${drawnSeries.length - 1 === 1 ? 'series is a line' : `${drawnSeries.length - 1} series are lines`}`,
    suggest: "highlight the series to fill; use variant 'stacked-area' when the series add up to a total, or 'line' to compare them as peers",
  });
  // Phases fill the area under their curve in their own tones, in place of the series' fill.
  const areaFilled = (s: NormSer): boolean => isArea && !domain.phases && (areaLead === undefined || s.id === areaLead.id);
  const { heroMode, heroId } = heroPlan(env, domain, warnings);
  const bumpSlot = bumpIdentity(env, domain, warnings);
  const bumpStory = bumpStoryPaintsOf(env, domain, grey);
  const contextRank = new Map<Id, number>();
  for (const s of drawnSeries) {
    const deEmphasized = grey ? !highlights.has(s.id) && !s.colorRole && !s.fill : heroMode && s.id !== heroId;
    if (deEmphasized) contextRank.set(s.id, contextRank.size);
  }
  // Only the grey highlight of a plain line reads the darker ladder; hero context lines and areas keep theirs.
  // A line with its own authored colour beside the greys keeps the light ladder, so the greys stay apart from it.
  // The lines beside an area's lead fill are plain lines.
  const plainGrey = grey && !isBump && (domain.variant === 'line' || areaLead !== undefined) &&
    drawnSeries.every((s) => highlights.has(s.id) || contextRank.has(s.id) || s.colorRole === 'highlight' || areaFilled(s));
  const contextRungCount = Math.min(CONTEXT_LADDER_INK_SHARE.length, contextRank.size);
  const ladderPaint = (inkShare: number): Paint =>
    inkShare === 0 ? { token: 'neutralLight' } : mixedPaint({ token: 'neutralLight' }, { token: 'markInk' }, 1 - inkShare, 'neutralLight');
  // Two context lines that cross are told apart by colour alone at the
  // crossing, so they stay as far apart as two steps of a named palette. A
  // ladder whose ends are close (a teal neutralLight under a teal ink) puts
  // neighbouring rungs 1.34:1 apart; the later line climbs the
  // ladder until it clears every earlier context line it crosses, or reaches
  // the top rung.
  const linesCross = (a: NormSer, b: NormSer): boolean => {
    const rowA = pv[rowOf.get(a)!]!;
    const rowB = pv[rowOf.get(b)!]!;
    const signs = new Set(rowA.flatMap((value, index) => {
      const other = rowB[index];
      return value === null || other === null || other === undefined || value === other ? [] : [Math.sign(value - other)];
    }));
    return signs.size === 2;
  };
  // The darker ladder holds only where every two crossing context lines on it stay a palette step apart.
  // That check depends on the theme, so where context lines cross, each context stroke records the choice as a
  // line-apart recipe with the darker shares and the crossing pairs: the paint step reruns the check in the theme it
  // paints in, and a cached layout repaints like a fresh one.
  const contextSeries = drawnSeries.filter((s) => contextRank.has(s.id));
  const darkShare = (s: NormSer) => LINE_GREY_LADDER_INK_SHARE[contextRank.get(s.id)! % LINE_GREY_LADDER_INK_SHARE.length]!;
  const crossingPairs: Array<[number, number]> = plainGrey && !isStacked ? contextSeries.flatMap((a, i) =>
    contextSeries.slice(i + 1).filter((b) => linesCross(a, b)).map((b): [number, number] => [darkShare(a), darkShare(b)])) : [];
  const darkLadder = plainGrey && crossingPairs.every(([a, b]) =>
    palettePerceptualDistance(css(ladderPaint(a)), css(ladderPaint(b))) >= PALETTE_NORMAL_FLOOR);
  const ladder = darkLadder ? LINE_GREY_LADDER_INK_SHARE : CONTEXT_LADDER_INK_SHARE;
  const top = CONTEXT_LADDER_INK_SHARE[CONTEXT_LADDER_INK_SHARE.length - 1]!;
  const ladderPaintOf = new Map<Id, Paint>();
  for (const s of drawnSeries) {
    const rank = contextRank.get(s.id);
    if (rank === undefined) continue;
    const apartFrom = isStacked ? [] : drawnSeries.flatMap((other) => {
      const paint = ladderPaintOf.get(other.id);
      return paint && linesCross(s, other) ? [paint] : [];
    });
    if (crossingPairs.length > 0) {
      const share = CONTEXT_LADDER_INK_SHARE[rank % CONTEXT_LADDER_INK_SHARE.length]!;
      const result: Paint = { token: 'neutralLight', theme: { kind: 'line-apart', share, top, apartFrom, darker: { share: darkShare(s), pairs: crossingPairs } } };
      css(result);
      ladderPaintOf.set(s.id, result);
      continue;
    }
    const share = ladder[rank % ladder.length]!;
    ladderPaintOf.set(s.id, apartFrom.length === 0 ? ladderPaint(share) : {
      token: 'neutralLight',
      theme: { kind: 'line-apart', share, top, apartFrom },
    });
  }
  const contextPaint = (s: NormSer): Paint => {
    const rank = (contextRank.get(s.id) ?? 0) % CONTEXT_LADDER_INK_SHARE.length;
    if (seriesCrossesShadedBand(s)) {
      const result: Paint = { token: 'neutralLight', theme: { kind: 'line-context', rank, rungCount: contextRungCount, seriesId: s.id } };
      css(result);
      return result;
    }
    return ladderPaintOf.get(s.id) ?? ladderPaint(ladder[rank % ladder.length]!);
  };
  // `s.id === heroId`, not `dataIdx === 0`: with a fan the drawn indices are
  // not dataSeries indices, and the thick line and the inked line must be the
  // same series. One definition of "the hero", used by both channels.
  /**
   * Plan lines use an outline with a background centre. Authored scenario
   * styling wins. A filled area and bump keep their existing defaults.
   */
  const planStyleOf = (s: NormSer) => !areaFilled(s) && !isBump ? planLineStyle(s.scenario, theme) : undefined;
  const lineHollowOf = (s: NormSer): boolean => planStyleOf(s) !== undefined;
  const scenarioStyleOf = (s: NormSer) => s.scenario === undefined ? undefined : {
    ...planStyleOf(s),
    ...options.scenarioStyle?.[s.scenario],
  };
  /**
   * A single unstacked area under a theme's `marks.areaTint`: the
   * fill is the focus washed toward the background and the line on top the
   * ink at 1.5 px. An authored fill, colorRole, palette, scenario ink or a
   * PY/PL series keeps its own colours.
   */
  const areaTint = theme.marks?.areaTint;
  const themedArea = (s: NormSer): boolean =>
    areaTint !== undefined && isArea && !isStacked && drawnSeries.length === 1 && !palette &&
    !s.fill && !s.colorRole && !scenarioStyleOf(s)?.ink && s.scenario !== 'PY' && s.scenario !== 'PL';
  // Series whose order is the encoding read one ramp, weakest first. Stacked bands are
  // parts of one total, so unset emphasis gives them the ordered ramp too; a highlight,
  // palette or series fill keeps its own colours, and emphasis 'none' the theme hues.
  const emphasis = options.emphasis ??
    (isStacked && !grey && !fade && options.palette === undefined && dataSeries.every((s) => !s.fill) ? 'ordered' : undefined);
  // A series with its own paint keeps it; the ramp series skip a step that
  // paints the same colour, so no two series of one chart look alike.
  // An area series reserves the paint its area draws: the focus when it is
  // highlighted, a colorRole's fill role.
  const slots = rampSlots(theme, dataSeries.map((s): Paint | undefined => {
    const ink = scenarioStyleOf(s)?.ink;
    if (s.fill) return { css: s.fill };
    if (isArea && grey && highlights.has(s.id)) return { token: 'focus' };
    return s.colorRole ? markRolePaint(s.colorRole, isArea) : ink ? { token: ink } : undefined;
  }), palette, !grey && !heroMode && !isBump && emphasis !== 'ordered' && dataSeries.length > 1 ? { labels: dataSeries.map((s) => s.label), warnings } : undefined);
  // A Rest series (colorRole 'others') beside the ordered ramp is the quietest part (othersShade).
  const quietRest = emphasis === 'ordered' && (options.othersShade ?? DEFAULT_OTHERS_SHADE) === 'quietest' &&
    dataSeries.some((s) => s.colorRole === 'others' && !s.fill);
  if (quietRest) pushAll(warnings, othersShadeUnavailableWarnings(theme, { token: 'markInk' }));
  const ordered = (s: NormSer): boolean =>
    emphasis === 'ordered' && !s.colorRole && !(grey && highlights.has(s.id));
  const series = (s: NormSer, dataIdx: number): Paint => {
    let paint: Paint;
    const scenarioInk = scenarioStyleOf(s)?.ink;
    if (themedArea(s)) paint = { token: 'markInk' };
    else if (s.fill) paint = { css: s.fill };
    else if (ordered(s)) paint = orderedRampPaint(dataIdx, dataSeries.length, quietRest);
    else if (bumpStory && !s.colorRole) paint = bumpStory.paintOf(s.id);
    else if (grey) paint = highlights.has(s.id) ? { token: 'focus' } : !s.colorRole ? contextPaint(s) : markRolePaint(s.colorRole);
    else if (heroMode) paint = s.id === heroId ? { token: 'markInk' } : contextPaint(s);
    else if (s.colorRole) paint = markRolePaint(s.colorRole);
    else if (scenarioInk) paint = { token: scenarioInk };
    else if (dataSeries.length === 1) paint = themeSeriesPaint(dataIdx, palette, s.scenario);
    else paint = themeSeriesPaint(isBump ? bumpSlot(dataIdx).color : slots[dataIdx] ?? dataIdx, palette);
    return shadeSafeStroke(faded(paint, s), s, paint);
  };
  const areaFillOwn = (s: NormSer, dataIdx: number, forecast = false): Paint => {
    // The forecast region keeps its hatch, drawn in the full focus.
    if (themedArea(s)) return forecast ? { token: 'focus' } : { token: 'focus', tint: areaTint };
    if (s.fill) return { css: s.fill };
    if (ordered(s)) return orderedRampPaint(dataIdx, dataSeries.length, quietRest);
    if (grey && highlights.has(s.id)) return { token: 'focus' };
    if (s.colorRole) return markRolePaint(s.colorRole, true);
    const scenarioInk = scenarioStyleOf(s)?.ink;
    if (scenarioInk) return { token: scenarioInk };
    if (dataSeries.length === 1) return themeSeriesPaint(dataIdx, palette, s.scenario);
    return themeSeriesPaint(slots[dataIdx] ?? dataIdx, palette);
  };
  const areaFill = (s: NormSer, dataIdx: number, forecast = false): Paint => faded(areaFillOwn(s, dataIdx, forecast), s);
  // A key names a series by the mark the reader sees: an area by its fill,
  // a line by its stroke. A themed single area is the exception, its wash sits
  // near the card (1.1:1 in dark) while its line carries the colour, so its
  // key takes the line.
  const keyPaint = (s: NormSer, dataIdx: number): Paint =>
    areaFilled(s) && !themedArea(s) ? areaFill(s, dataIdx) : !isArea && s.scenario === 'FC' && domain.variant !== 'line'
      ? forecastStroke(series(s, dataIdx), theme, seriesCrossesShadedBand(s)) : series(s, dataIdx);
  const { fanLadder, fanCentrePaint, fanPaints } = buildFanPaints({
    fan: domain.fan, drawnSeries, seriesPaint: series, paintCss: css, theme, anyHighlight, highlights,
  });
  // Third bump identity channel, and it only ever engages past
  // `rampLen * shapes` entities; the author's own `lineStyle` still wins.
  const dashOf = (s: NormSer, dataIdx: number): number[] | undefined =>
    s.lineStyle === 'dashed' ? dashToken(theme, 'reference') : s.lineStyle === 'dotted' ? dashToken(theme, 'dotted') : isBump ? bumpSlot(dataIdx).dash : undefined;
  const pointScenario = (s: NormSer, ci: number): Scenario | undefined => s.vals[ci]!.scenario ?? s.scenario;
  return {
    css,
    bandRules: () => [...bandRules.values()],
    seriesCrossesShadedBand,
    series,
    areaFill,
    areaFilled,
    keyPaint,
    lineHollowOf,
    lineWidthOf: (s) =>
      themedArea(s) ? strokeToken(theme, 'data') : (anyHighlight && highlights.has(s.id)
        ? strokeToken(theme, 'focus')
        : heroId
          ? (s.id === heroId ? strokeToken(theme, 'focus') : strokeToken(theme, 'data'))
          : bumpStory?.isContext(s) ? strokeToken(theme, 'mark') : scenarioStyleOf(s)?.width ?? strokeToken(theme, 'data')),
    ref: (s) => (s.fill ? { css: s.fill } : s.colorRole ? { token: markRoleToken(s.colorRole) } : { token: 'ink' }),
    dashOf,
    legendDashOf: (s, dataIdx) => (s.scenario === 'FC' ? dashToken(theme, 'reference') : dashOf(s, dataIdx)),
    // Bump ignores the density cutoff: the marker is what makes a crossing
    // readable. A partial period keeps a (hollow) marker where density drops
    // the rest. A theme without default markers drops them as the cutoff does.
    markerOf: (s, dataIdx, ci) =>
      s.marker ?? (bumpStory ? bumpStory.isContext(s) ? 'none' : 'circle' : isBump ? bumpSlot(dataIdx).shape : isArea || ((markersOff || cats.length > MARKER_MAX_CATS) && cats[ci]!.partial !== true) ? 'none' : contextRank.has(s.id) ? plainGrey ? LINE_GREY_SHAPES[contextRank.get(s.id)! % LINE_GREY_SHAPES.length]! : BUMP_SHAPES[contextRank.get(s.id)! % BUMP_SHAPES.length]! : 'circle'),
    hollowAt: (s, ci) => {
      const sc = pointScenario(s, ci);
      return sc === 'PY' || sc === 'PL' || sc === 'FC' || cats[ci]!.partial === true;
    },
    pointScenario,
    // A bump point carries BOTH quantities: `display.value` stays the metric
    // and `display.state` names the rank the y position encodes.
    bumpPointState: (row, ci): { state: string } | Record<string, never> => (isBump && row[ci] !== null ? { state: `rank ${row[ci]}` } : {}),
    heroMode,
    heroId,
    fanLadder,
    fanCentrePaint,
    fanPaints,
  };
}
