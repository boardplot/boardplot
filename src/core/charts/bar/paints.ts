/**
 * Standard bar phase 1, paints: one paint decision per series and cell,
 * shared by the legend, the marks and the labels.
 */

import { partialPattern } from '../../partialPeriod';
import { colorRolePaints, effectiveFill, neutralRampPaint, paintColor, recedingSeriesId, seriesPaint as themeSeriesPaint, stackApartPaint, stackRampPaint } from '../../theme';
import { signColorOverrides, signPaint } from '../band/sign';
import type { CellMeta, Id } from '../../types/cell';
import type { LintWarning, Paint } from '../../types/scene';
import { OTHERS_ID, type BarDomain, type BarPaints, type NormCat, type NormSeries } from './model';

type BarFill = { paint: Paint; pattern?: 'hatch45' | 'outline'; outline?: boolean };

/** The legend's view of the paints: the series identity and the scenario fill without the partial hatch. */
export interface BarLegendPaints extends BarPaints {
  identity(s: NormSeries): Paint;
  scenario(s: NormSeries, catId: Id, meta: CellMeta | null): BarFill;
}

export function barPaints(domain: BarDomain, warnings: LintWarning[]): BarLegendPaints {
  const { options, theme, palette, highlights, dataSeries, uniformScenario, restRecedes } = domain;
  const signColor = options.signColor === true;
  if (signColor) signColorOverrides(domain.cats, dataSeries, highlights, OTHERS_ID, (s, ci) => ({ v: s.cells[ci]!.v, fill: s.cells[ci]!.meta?.fill }), warnings);
  const receding = recedingSeriesId(dataSeries, highlights);
  // A stack's net line marks the sum up to its series. A plain series stacked
  // beyond that tick is outside the marked sum and recedes into the rest tone,
  // so the tick reads against it.
  const netAt = domain.netLineOn && domain.netLineSeries ? dataSeries.findIndex((s) => s.id === domain.netLineSeries!.id) : -1;
  const highlighted = dataSeries.some((s) => !s.fill && (s.colorRole === 'highlight' || (!s.colorRole && highlights.has(s.id))));
  const plainParts = dataSeries.filter((s) => !s.fill && !s.colorRole && !highlights.has(s.id)).map((s) => s.id);
  const stackGreys = domain.variant !== 'grouped' && highlighted && plainParts.length >= 2 ? plainParts : [];
  const beyondNet = new Set(netAt >= 0 ? dataSeries.slice(netAt + 1).filter((s) => !s.fill && !s.colorRole && !highlights.has(s.id)).map((s) => s.id) : []);
  // The plain series of a stack take the theme's stack ramp, dark to light in
  // authored order. An authored fill or palette keeps its colour. A highlight, a colour role, a
  // receding series or a rest beyond a net line keeps every series in its own colour.
  const marked = highlighted || receding !== undefined || beyondNet.size > 0 || dataSeries.some((s) => s.colorRole !== undefined || highlights.has(s.id));
  const stackPlain = (domain.variant === 'stacked' || domain.variant === 'stacked100') && palette === undefined && !marked
    ? dataSeries.filter((s) => !s.fill) : [];
  // A plain series of a stack beside authored colours keeps apart from them in the active theme (domain's rampSlots input).
  const roles = colorRolePaints(dataSeries);
  const ownPaints = dataSeries.map((s): Paint | undefined =>
    s.fill ? { css: s.fill } : s.colorRole ? roles.get(s.id)! : highlights.has(s.id) ? { token: 'focus' } : undefined);
  const stackOwn = domain.variant !== 'grouped' && ownPaints.some(Boolean) ? ownPaints : undefined;
  const seriesIdentityPaint = (s: NormSeries, scenario = s.scenario): Paint => {
    if (s.fill) return { css: s.fill };
    if (s.colorRole) return roles.get(s.id)!;
    if (highlights.has(s.id)) return { token: 'focus' };
    // The plain sibling of a highlight recedes into the full neutral mark, dark
    // enough to carry white value labels inside its bar ends; lines and slopes
    // keep the lighter muted tint.
    if (s.id === receding) return { token: 'neutralMark' };
    // Several plain parts of a stack beside a highlight recede on the neutral
    // ramp, strongest to quietest in authored order.
    const grey = stackGreys.indexOf(s.id);
    if (grey >= 0) return neutralRampPaint(grey, stackGreys.length, scenario === 'FC');
    if (beyondNet.has(s.id)) return { token: 'rest' };
    if (dataSeries.length === 1) return themeSeriesPaint(s.slot, palette, scenario, true);
    if (stackPlain.length > 1 && stackPlain.includes(s)) return stackRampPaint(stackPlain.indexOf(s), stackPlain.length, s.slot);
    if (stackOwn) return stackApartPaint(stackOwn, dataSeries.indexOf(s), s.slot, palette);
    // A forecast bar of several series keeps its key colour: its hatch lies on
    // its own ground (hatchGroundPaint), as column's does.
    return themeSeriesPaint(s.slot, palette);
  };
  /** Fill + pattern for a bar/segment (scenario semantics fixed by spec). */
  const barPaint = (s: NormSeries, catId: Id, meta: CellMeta | null, v: number | null = null): BarFill => {
    const scen = meta?.scenario ?? s.scenario;
    const preservesSeriesIdentity = uniformScenario.has(catId);
    const pattern =
      scen === 'FC'
        ? ('hatch45' as const)
        : scen === 'PL' && !preservesSeriesIdentity
          ? ('outline' as const)
          : undefined;
    const outline = preservesSeriesIdentity && scen === 'PL' ? true : undefined;
    if (meta?.fill) return { paint: { css: meta.fill }, pattern, outline };
    // Sign colour outranks series paint, scenario and the receding rest, and
    // loses to a cell fill, the Others bucket and a highlight, as on column.
    if (signColor && catId !== OTHERS_ID && !highlights.has(s.id) && !highlights.has(catId)) {
      return { paint: signPaint(s, v, options.colorblindSafe), pattern, outline };
    }
    if (s.fill) return { paint: { css: s.fill }, pattern, outline };
    if (catId === OTHERS_ID) return { paint: { token: 'othersMark' }, pattern, outline };
    if (s.colorRole) return { paint: roles.get(s.id)!, pattern, outline };
    if (highlights.has(s.id)) return { paint: { token: 'focus' }, pattern, outline };
    if (highlights.has(catId) && dataSeries.length === 1) {
      return { paint: { token: 'focus' }, pattern, outline };
    }
    if (scen) return { paint: seriesIdentityPaint(s, scen), pattern, outline };
    // The rest role, which falls back to neutralLight.
    if (restRecedes) return { paint: { token: 'rest' }, pattern, outline };
    return { paint: seriesIdentityPaint(s), pattern, outline };
  };
  return {
    cell: (s: NormSeries, cat: NormCat, meta: CellMeta | null, v: number | null) => {
      const { paint, pattern, outline } = barPaint(s, cat.id, meta, v);
      return { paint, pattern: partialPattern(cat, pattern, outline), outline };
    },
    css: (paint, pattern) => effectiveFill(paintColor(theme, paint), pattern, theme),
    reference: () =>
      (domain.referenceStyle === 'marker'
        ? { token: 'neutralMark' }
        : domain.referenceStyle === 'tick' && domain.referenceTick.color === 'highlight'
          ? { token: 'highlight' }
          : { token: 'ink' }),
    identity: (s) => seriesIdentityPaint(s),
    scenario: barPaint,
  };
}
