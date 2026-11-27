/**
 * Standard bar phase 1, paints: one paint decision per series and cell,
 * shared by the legend, the marks and the labels.
 */

import { partialPattern } from '../../partialPeriod';
import { effectiveFill, neutralRampPaint, paintColor, seriesPaint as themeSeriesPaint, stackApartPaint, stackRampPaint } from '../../theme';
import { signColorOverrides, signPaint } from '../band/sign';
import { scenarioFillPattern, scenarioSlotPaint, seriesScenarioRole } from '../../scenarioPairs';
import type { CellMeta, Id } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';
import { OTHERS_ID, type BarDomain, type BarPaints, type NormCat, type NormSeries } from './model';

type BarFill = { paint: Paint; pattern?: 'hatch45' | 'outline'; outline?: boolean };

/** The legend's view of the paints: the series identity and the scenario fill without the partial hatch. */
export interface BarLegendPaints extends BarPaints {
  identity(s: NormSeries): Paint;
  scenario(s: NormSeries, catId: Id, meta: CellMeta | null): BarFill;
}

export function barSeriesScenario(s: NormSeries) {
  return seriesScenarioRole(s.scenario, s.cells.filter((c) => c.v !== null).map((c) => c.meta?.scenario));
}

export function barPaints(domain: BarDomain, warnings: LintWarning[]): BarLegendPaints {
  // Every paint decision reads every plotted series, so a series a reader hides leaves each other its colour.
  const { options, theme, palette, highlights, keySeries: dataSeries, uniformScenario, restRecedes } = domain;
  const signColor = options.signColor === true;
  if (signColor) signColorOverrides(domain.cats, domain.dataSeries, highlights, OTHERS_ID, (s, ci) => ({ v: s.cells[ci]!.v, fill: s.cells[ci]!.meta?.fill }), warnings);
  // A stack's net line marks the sum up to its series. A plain series stacked
  // beyond that tick is outside the marked sum and recedes into the rest tone,
  // so the tick reads against it.
  const netAt = domain.netKeyIndex;
  const stacked = domain.variant !== 'grouped';
  const highlighted = dataSeries.some((s) => !s.fill && (s.colorRole === 'highlight' || (!s.colorRole && highlights.has(s.id))));
  const plainParts = dataSeries.filter((s) => !s.ownPaint);
  const receding = highlighted && plainParts.length === 1 ? plainParts[0]!.id : undefined;
  const stackGreys = stacked && highlighted && plainParts.length >= 2 ? plainParts.map((s) => s.id) : [];
  const beyondNet = new Set<Id>();
  if (netAt >= 0) for (let i = netAt + 1; i < dataSeries.length; i++) {
    const series = dataSeries[i]!;
    if (!series.ownPaint) beyondNet.add(series.id);
  }
  // The plain series of a stack take the theme's stack ramp, dark to light in
  // authored order. An authored fill or palette keeps its colour. A highlight, a colour role, a
  // receding series or a rest beyond a net line keeps every series in its own colour.
  const marked = highlighted || beyondNet.size > 0 || dataSeries.some((s) => s.colorRole !== undefined || highlights.has(s.id));
  const stackPlain = (domain.variant === 'stacked' || domain.variant === 'stacked100') && palette === undefined && !marked ? plainParts : [];
  // A plain series of a stack beside authored colours keeps apart from them in the active theme (domain's rampSlots input).
  const stackOwn = stacked && plainParts.length < dataSeries.length ? dataSeries.map((s) => s.ownPaint) : undefined;
  const seriesIdentityPaint = (s: NormSeries, scenario = barSeriesScenario(s)): Paint => {
    if (s.ownPaint) return s.ownPaint;
    // The plain sibling of a highlight recedes into the full neutral mark, dark
    // enough to carry white value labels inside its bar ends; lines and slopes
    // keep the lighter muted tint.
    if (s.id === receding) return { token: 'neutralMark' };
    // Several plain parts of a stack beside a highlight recede on the neutral
    // ramp, strongest to quietest in authored order.
    const grey = stackGreys.indexOf(s.id);
    if (grey >= 0) return neutralRampPaint(grey, stackGreys.length, scenario === 'FC');
    if (beyondNet.has(s.id)) return { token: 'rest' };
    const partner = domain.scenarioPartner.get(s.id);
    if (partner) return seriesIdentityPaint(partner, scenario);
    if (dataSeries.length === 1) return themeSeriesPaint(s.slot, palette, scenario, true);
    if (stackPlain.length > 1 && stackPlain.includes(s)) return stackRampPaint(stackPlain.indexOf(s), stackPlain.length, s.slot);
    if (stackOwn) return stackApartPaint(stackOwn, dataSeries.indexOf(s), s.slot, palette);
    if (stacked) return themeSeriesPaint(s.slot, palette);
    return scenarioSlotPaint(s.slot, palette, scenario);
  };
  /** Fill + pattern for a bar/segment (scenario semantics fixed by spec). */
  const barPaint = (s: NormSeries, catId: Id, meta: CellMeta | null, v: number | null = null): BarFill => {
    const scen = meta?.scenario ?? s.scenario;
    const preservesSeriesIdentity = uniformScenario.has(catId);
    const scenarioPattern = scenarioFillPattern(scen);
    const outline = preservesSeriesIdentity && scenarioPattern === 'outline' ? true : undefined;
    const pattern = outline ? undefined : scenarioPattern;
    let paint: Paint;
    if (meta?.fill) paint = { css: meta.fill };
    // Sign colour outranks series paint, scenario and the receding rest, and
    // loses to a cell fill, the Others bucket and a highlight, as on column.
    else if (signColor && catId !== OTHERS_ID && !highlights.has(s.id) && !highlights.has(catId)) paint = signPaint(s, v, options.colorblindSafe);
    else if (catId === OTHERS_ID && !s.fill) paint = { token: 'othersMark' };
    else if (s.ownPaint) paint = s.ownPaint;
    else if (highlights.has(catId) && dataSeries.length === 1) paint = { token: 'focus' };
    else if (!scen && restRecedes) paint = { token: 'rest' };
    else paint = seriesIdentityPaint(s, scen || undefined);
    return { paint, pattern, outline };
  };
  return {
    cell: (s: NormSeries, cat: NormCat, meta: CellMeta | null, v: number | null) => {
      const look = barPaint(s, cat.id, meta, v);
      look.pattern = partialPattern(cat, look.pattern, look.outline);
      return look;
    },
    css: (paint, pattern) => effectiveFill(paintColor(theme, paint), pattern, theme),
    reference: () =>
      (domain.referenceStyle === 'marker'
        ? { token: 'neutralMark' }
        : domain.referenceStyle === 'tick' && domain.referenceTick.color === 'highlight'
          ? { token: 'highlight' }
          : { token: 'ink' }),
    identity: seriesIdentityPaint,
    scenario: barPaint,
  };
}
