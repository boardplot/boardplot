import { localeStrings } from '../../strings';
import type { StringsSpec } from '../../types/options';
/**
 * Column phase 1, paints: one paint decision per series and cell, shared by
 * the legend, the marks and the labels.
 */

import { DEFAULT_OTHERS_SHADE } from '../../othersShade';
import { othersShadeUnavailableWarnings } from '../../paintWarnings';
import { colorRolePaints, effectiveFill, markRolePaint, markRoleToken, mutedMarkPaint, neutralRampPaint, orderedRampPaint, paintColor, rampSlots, recedingRampIds, stackApartPaint, stackRampPaint, recedingSeriesId, seriesPaint as themeSeriesPaint } from '../../theme';
import { signColorOverrides, signPaint } from '../band/sign';
import { partialPattern } from '../../partialPeriod';
import type { Category } from '../../types/data';
import type { Scenario } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';
import type { ColumnDomain, ColumnPaints, NormSer, NormVal } from './model';
import { columnCorridorPaint } from './anomaly';

/**
 * The legend's view of the paints: the series swatches, and the scenario
 * patterns the cells actually paint.
 */
export interface ColumnLegendPaints extends ColumnPaints {
  identity(s: NormSer, dataIdx: number): Paint;
  base(s: NormSer, dataIdx: number): Paint;
  /** Every scenario pattern the cells paint (partial-period hatch excluded). */
  cellPatterns: ('hatch45' | 'outline' | undefined)[];
  /** Whether any cell paints the partial-period hatch. */
  partialHatch: boolean;
}

/**
 * Names the polarity a sign-coloured column carries. Under
 * `direction: 'lowerIsBetter'` the whole encoding inverts — positives paint
 * red, negatives green — and a reader applying the universal red = negative
 * reading gets every judgement backwards. Sign semantics are DECLARED, never
 * inferred, so the word travels with the swatch.
 */
export function signWord(s: NormSer, positive: boolean, strings?: StringsSpec): string {
  return positive === (s.direction !== 'lowerIsBetter') ? strings?.better ?? localeStrings().better : strings?.worse ?? localeStrings().worse;
}

export function seriesPattern(s: NormSer): 'hatch45' | 'outline' | undefined {
  return s.scenario === 'FC' ? 'hatch45' : s.scenario === 'PL' ? 'outline' : undefined;
}

/** Phase 1, paints: the paint closures, and the sign-colour override disclosures. */
export function columnPaints(domain: ColumnDomain, warnings: LintWarning[]): ColumnLegendPaints {
  const { options, theme, palette, highlights, cats, dataSeries, variant, plottedOf, othersId, signColor, uniformScenario } = domain;
  // One pass resolves the same few paints once per cell, legend entry and adjacency check, and a
  // visible-tint paint walks contrast steps each time. Paints are plain data and the theme is fixed
  // for this call, so the colour is cached per paint value.
  const resolved = new Map<string, string>();
  const paintCss = (paint: Paint): string => {
    const key = JSON.stringify(paint);
    let css = resolved.get(key);
    if (css === undefined) resolved.set(key, css = paintColor(theme, paint));
    return css;
  };
  // A series with its own paint keeps it; the ramp series skip a step that
  // paints the same colour, so no two series of one chart look alike.
  // Colour follows the series, not its sorted place, so sorting
  // the segments never recolours one. Slots are dealt in authored order.
  const authored = domain.seriesNorm.filter((s) => dataSeries.includes(s));
  // Notation rule: a scenario series is a view of an actual, so it takes that actual's colour and
  // its scenario draws the difference (PY a wash, FC a hatch, PL an outline). The k-th PY, PL or
  // FC series pairs with the k-th actual (no scenario or AC), in authored order, so series order
  // never changes the look. A series whose cells all carry one scenario counts as that scenario.
  const roleOf = (s: NormSer): Scenario | undefined => {
    if (s.scenario) return s.scenario;
    const own = s.vals.filter((val) => val.v !== null).map((val) => val.scenario);
    return own.length > 0 && own.every((sc) => sc === own[0]) ? own[0] : undefined;
  };
  // A stack keeps its stack colours: there only a plan pairs, as it always did, and keeps its step.
  const stackLike = variant === 'stacked' || variant === 'stacked100';
  const ownPaint = (x: NormSer): boolean => !!x.fill || !!x.colorRole || highlights.has(x.id);
  const roleIn = (x: NormSer): Scenario | undefined => (stackLike ? x.scenario : roleOf(x));
  const pairOrder = stackLike ? dataSeries : authored;
  const actuals = pairOrder.filter((x) => { const role = roleIn(x); return role === undefined || role === 'AC'; });
  const scenarioPartner = new Map<string, NormSer>();
  for (const sc of stackLike ? (['PL'] as const) : (['PY', 'PL', 'FC'] as const)) {
    pairOrder.filter((x) => roleIn(x) === sc).forEach((x, k) => {
      const actual = actuals[k];
      // A prior year draws its actual's colour as a wash, which needs the theme's series colour:
      // beside an actual in an authored colour or role it keeps a washed step of its own.
      if (actual && (sc !== 'PY' || !ownPaint(actual))) scenarioPartner.set(x.id, actual);
    });
  }
  const roles = colorRolePaints(authored);
  const ownPaints = authored.map((s): Paint | undefined =>
    s.fill ? { css: s.fill } : s.colorRole ? roles.get(s.id)! : highlights.has(s.id) ? { token: 'focus' } : undefined);
  // A paired scenario series of grouped columns takes no ramp step of its own. One with its own
  // paint keeps it, so it stays in the deal and the plain series step past its colour.
  const dealt = authored.filter((s) => stackLike || ownPaint(s) || !scenarioPartner.has(s.id));
  const authoredSlots = rampSlots(theme, dealt.map((s) => ownPaints[authored.indexOf(s)]), palette, { labels: dealt.map((s) => s.label), warnings });
  // A plain series of a stack beside authored colours keeps apart from them in the active theme.
  const stackOwn = (variant === 'stacked' || variant === 'stacked100') && ownPaints.some(Boolean) ? ownPaints : undefined;
  // A Rest series (colorRole 'others') beside the ordered ramp is the quietest part (othersShade).
  const quietRest = !!options.seriesRamp && (options.othersShade ?? DEFAULT_OTHERS_SHADE) === 'quietest' &&
    authored.some((s) => s.colorRole === 'others' && !s.fill);
  if (quietRest) warnings.push(...othersShadeUnavailableWarnings(theme, { token: 'markInk' }));
  const slotOf = new Map(dealt.map((s, i) => [s.id, authoredSlots[i] ?? i]));
  const receding = recedingSeriesId(dataSeries, highlights);
  const slots = dataSeries.map((s, i) => slotOf.get(s.id) ?? i);
  // Two or more plain series of a stack beside a highlight recede on the neutral ramp, strongest
  // to quietest in authored order. A plan paired with its actual keeps the actual's step.
  const rampIds = stackLike && !options.seriesRamp ? recedingRampIds(authored.filter((s) => !scenarioPartner.has(s.id)), highlights) : [];
  // The plain series of a stack take the theme's stack ramp, dark to light in authored order.
  // An authored fill or palette keeps its colour. A highlight, a colour role or a receding
  // series keeps every series in its usual colour.
  const marked = authored.some((s) => s.colorRole !== undefined || highlights.has(s.id) || s.id === receding);
  const stackPlain = (variant === 'stacked' || variant === 'stacked100') && palette === undefined && !marked
    ? authored.filter((s) => !s.fill) : [];
  const seriesIdentityPaint = (
    s: NormSer,
    dataIdx: number,
    scenario = roleOf(s),
  ): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return roles.get(s.id) ?? markRolePaint(s.colorRole, true);
    // A highlighted series is drawn in focus (cellPaint), so its legend key is too.
    if (highlights.has(s.id)) return markRolePaint('focus', true);
    // Series whose order is the encoding take the ordered ramp, in authored order.
    if (options.seriesRamp) return orderedRampPaint(authored.length - 1 - authored.indexOf(s), authored.length, quietRest);
    if (s.id === receding) return mutedMarkPaint();
    const step = rampIds.indexOf(s.id);
    if (step >= 0) return neutralRampPaint(step, rampIds.length, scenario === 'FC');
    const partner = scenarioPartner.get(s.id);
    if (partner) return seriesIdentityPaint(partner, dataSeries.indexOf(partner), scenario);
    const slot = slots[dataIdx] ?? dataIdx;
    if (dataSeries.length === 1) return themeSeriesPaint(slot, palette, scenario, true);
    if (stackPlain.length > 1 && stackPlain.includes(s)) return stackRampPaint(stackPlain.indexOf(s), stackPlain.length, slot);
    if (stackOwn && authored.includes(s)) return stackApartPaint(stackOwn, authored.indexOf(s), slot, palette);
    if (stackLike) return themeSeriesPaint(slot, palette);
    // A prior year draws its colour at the scenario wash, apart from the actual it shares it with.
    if (scenario === 'PY') return themeSeriesPaint(slot, palette, 'PY', true, false, true);
    // A forecast keeps its key colour where its hatch reads on the page; scenarioSeriesColor lifts
    // only a colour whose hatch would fade into the page (an actual near a dark page's floor).
    return scenario === 'FC' ? themeSeriesPaint(slot, palette, 'FC', true, false, true) : themeSeriesPaint(slot, palette);
  };
  /**
   * The bar rule: a category highlight on one series makes the named
   * columns the subject, so every other column steps back to `neutralLight`
   * (the legend swatch too). With several series the colours carry series
   * identity and stay. Only a highlighted column with a body counts: null, a
   * zero (stacked skips it, grouped draws a 0.5px hairline) or a suppressed
   * stacked100 row plots as null or 0, and would leave no subject.
   */
  const restRecedes =
    dataSeries.length === 1 && cats.some((c, ci) => highlights.has(c.id) && (plottedOf(dataSeries[0]!, ci) ?? 0) !== 0);
  const seriesBasePaint = (s: NormSer, dataIdx: number): Paint => {
    // The rest role, which falls back to neutralLight.
    if (restRecedes && !s.fill && !s.colorRole && !s.scenario) return { token: 'rest' };
    return seriesIdentityPaint(s, dataIdx);
  };
  const cellPaint = (s: NormSer, val: NormVal, cat: Category, dataIdx: number): Paint => {
    if (val.fill) return { css: val.fill };
    if (othersId !== null && cat.id === othersId) return { token: 'othersMark' };
    // A series fill or colorRole outranks the highlight, as in bar and dot.
    // With several series a highlighted category keeps each
    // series' fill, so every column matches its key; the columns take a
    // focus outline instead (marks.ts).
    if (highlights.has(s.id) || (highlights.has(cat.id) && dataSeries.length === 1)) return s.fill ? { css: s.fill } : s.colorRole ? roles.get(s.id) ?? markRolePaint(s.colorRole, true) : markRolePaint('focus', true);
    // Sign colour outranks every identity/scenario fill but loses to the three
    // authored overrides above (see signColorOverrides).
    if (signColor) return signPaint(s, val.v, options.colorblindSafe);
    if (uniformScenario.has(cat.id)) {
      return seriesIdentityPaint(s, dataIdx, val.scenario ?? s.scenario);
    }
    if (val.scenario) {
      return seriesIdentityPaint(s, dataIdx, val.scenario);
    }
    return seriesBasePaint(s, dataIdx);
  };
  const scenarioPattern = (
    s: NormSer,
    val: NormVal,
    cat: Category,
  ): 'hatch45' | 'outline' | undefined => {
    const sc = val.scenario ?? s.scenario;
    if (uniformScenario.get(cat.id) === 'PL') return undefined;
    return sc === 'FC' ? 'hatch45' : sc === 'PL' ? 'outline' : undefined;
  };
  const cellOutline = (cat: Category): boolean =>
    uniformScenario.get(cat.id) === 'PL';
  // A partial category hatches too, but it is no scenario: the legend's
  // scenario keys read `scenarioPattern` and the footnote names the period.
  const cellPattern = (s: NormSer, val: NormVal, cat: Category): 'hatch45' | 'outline' | undefined =>
    partialPattern(cat, scenarioPattern(s, val, cat), cellOutline(cat));
  if (signColor) signColorOverrides(cats, dataSeries, highlights, othersId, (s, ci) => s.vals[ci]!, warnings);
  /**
   * Every scenario pattern the CELLS will actually paint, walked over exactly
   * the cells the emit guards admit: grouped draws every non-null value (a
   * zero still paints a 0.5u stub), stacked and stacked100 skip zeros.
   * Scenario is a cell property, so a series that is AC in three categories
   * and FC in the fourth paints a hatch that `seriesPattern` cannot see; this
   * is what gives the legend its scenario key.
   */
  const paintedCells: { s: NormSer; val: NormVal; c: Category }[] = [];
  for (const s of dataSeries) {
    cats.forEach((c, ci) => {
      const v = plottedOf(s, ci);
      if (v === null) return;
      if (variant !== 'grouped' && v === 0) return;
      paintedCells.push({ s, val: s.vals[ci]!, c });
    });
  }
  const refPaintOf = (s: NormSer): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return { token: markRoleToken(s.colorRole) };
    return { token: 'ink' };
  };
  return {
    css: paintCss,
    cell: cellPaint,
    pattern: cellPattern,
    outline: cellOutline,
    // what the viewer SEES: outline reads as background, hatch as a
    // mostly-background blend — auto-ink must contrast against that
    inside: (s, val, cat, dataIdx) => effectiveFill(paintCss(cellPaint(s, val, cat, dataIdx)), cellPattern(s, val, cat), theme),
    corridor: columnCorridorPaint(options.colorblindSafe),
    ref: refPaintOf,
    refStroke: (s) => (domain.refStyle === 'tick' && !s.fill && !s.colorRole ? { token: 'axis' } : refPaintOf(s)),
    identity: seriesIdentityPaint,
    base: seriesBasePaint,
    cellPatterns: paintedCells.map(({ s, val, c }) => scenarioPattern(s, val, c)),
    partialHatch: paintedCells.some(({ s, val, c }) => cellPattern(s, val, c) !== scenarioPattern(s, val, c)),
  };
}

