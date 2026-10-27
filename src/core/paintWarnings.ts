import { resolveAdjacentSeriesWarningRule } from './adjacentSeries';
import { bulletBandPaints, lineBandAuthoredWarnings } from './colorRecipes';
import { contrastRatio, readsAsLoss } from './color';
import { pieRamp } from './pieRamp';
import { farGround, focusColor, hatchPaint, hatchStrokeWidthFor, paintColor, paintTokenColor, PLAN_MUTED_PAINT, seriesTextAlone, solidMutedPlan, strokeToken, visibleTintAmount } from './theme';
import { isHatchPattern } from './svgPath';
import type { LintWarning, MarkOnBand, Paint, PaintWarningRule } from './types/scene';
import type { Theme } from './types/theme';
import { FILL_SEPARATION_FLOOR } from './themeRules';

export function highlightPaintWarnings(theme: Theme, chart: 'waterfall' | 'variance'): LintWarning[] {
  // A highlighted bridge step takes the focus colour. A variance
  // chart routes no mark through the focus, so it keeps testing the accent.
  const focused = chart === 'waterfall' && theme.color.focus !== undefined;
  const paint = focused ? focusColor(theme) : theme.color.highlight;
  const role = focused ? 'focus colour' : 'accent';
  return readsAsLoss(paint) ? [{
      code: 'highlight-reads-as-loss', severity: 'warn',
      message: `the theme ${role} ${paint} is a warm red or orange; a highlighted ${chart === 'waterfall' ? 'step' : 'variance'} in that colour reads as a loss`,
      suggest: chart === 'waterfall'
        ? 'use a theme with a cool accent (boardroom, studio) for bridges, or drop the highlight'
        : 'use a theme with a cool accent for variance charts, or drop the highlight',
    }] : [];
}

/**
 * `othersShade: 'quietest'` needs the first named step to have more contrast
 * against the page than the Others colour. When it does not, the ramp keeps
 * the 'apart' shades; this tells the host why.
 */
export function othersShadeUnavailableWarnings(theme: Theme, base: Paint): LintWarning[] {
  const named = paintColor(theme, base);
  const others = paintTokenColor(theme, 'othersMark');
  if (contrastRatio(named, theme.color.background) > contrastRatio(others, theme.color.background)) return [];
  return [{
    code: 'others-shade-unavailable',
    severity: 'info',
    message: `the Others colour '${others}' is stronger on the page than the first named step '${named}', so Others cannot be the quietest part; the ramp keeps the 'apart' shades`,
    suggest: "use a quieter othersMark or othersShade: 'apart'",
  }];
}

/** Warn only when no visible fill, stripe or outline separates the mark from its band. */
export function markLostOnBandWarnings(theme: Theme, pairs: readonly MarkOnBand[]): LintWarning[] {
  const visiblePaints = (pair: MarkOnBand): Paint[] => {
    if (isHatchPattern(pair.pattern)) return [
      pair.hatchGround ?? { token: 'background' },
      ...(hatchStrokeWidthFor(theme, pair.hatch) > 0 ? [hatchPaint(pair.fill, theme, pair.hatchGround, pair.hatch)] : []),
      ...(pair.hatchEdge !== false && strokeToken(theme, 'hair') > 0 ? [pair.fill] : []),
    ];
    if (pair.pattern === 'outline' && solidMutedPlan(theme)) return [PLAN_MUTED_PAINT];
    if (pair.pattern === 'outline' || pair.pattern === 'hollow') return [
      { token: 'background' }, ...(theme.pattern.outlineStrokeWidth > 0 ? [pair.fill] : []),
    ];
    return [pair.fill, ...(pair.stroke && (pair.strokeWidth ?? strokeToken(theme, 'mark')) > 0 ? [pair.stroke] : [])];
  };
  const lost = new Map(pairs.filter((pair) => visiblePaints(pair).every(paint => contrastRatio(paintColor(theme, paint), paintColor(theme, pair.band)) < FILL_SEPARATION_FLOOR))
    .map((pair) => [pair.name, pair.owner] as const));
  return [...lost].map(([name, owner]) => ({
    code: 'mark-lost-on-band', severity: 'warn',
    message: `'${name}' has no visible contrast against the band behind it and disappears inside the band`,
    suggest: 'give the series a fill or colorRole that stands apart from the band, or move the band off its marks',
    owner,
  }));
}

/**
 * Table text on an authored ground on the other side of the page's lightness: a tone with no step at 4.5:1 there
 * prints in the ground's readable ink and loses its colour; a ground on which not even that ink reads keeps its text
 * under 4.5:1. One warning each (authored low contrast draws and warns).
 */
export function groundTextWarnings(theme: Theme, texts: readonly Paint[]): LintWarning[] {
  const tones = new Set<string>();
  const unreadable = new Map<string, number>();
  for (const text of texts) {
    const source = 'theme' in text ? text.theme : undefined;
    if (source?.kind !== 'ground-text') continue;
    const far = farGround(theme, source.ground);
    if (far === undefined) continue;
    const tone = source.far !== undefined && 'token' in source.far && ['good', 'bad', 'warn'].includes(source.far.token) ? source.far.token : undefined;
    if (tone !== undefined && seriesTextAlone(paintColor(theme, source.far!), far) === undefined) tones.add(tone);
    const ratio = contrastRatio(paintColor(theme, text), far);
    if (ratio < 4.5) unreadable.set(far, Math.min(ratio, unreadable.get(far) ?? Infinity));
  }
  return [
    ...(tones.size > 0 ? [{
      code: 'table-tone-text-unreadable', severity: 'warn' as const,
      message: `no step of the ${[...tones].join(', ')} tone reads at 4.5:1 on an authored table ground on the other side of the page's lightness, so its toned text prints in the ground's readable ink`,
      suggest: 'choose table.grounds on the page side of lightness, or tone colours that stand apart from them',
    }] : []),
    ...(unreadable.size > 0 ? [{
      code: 'table-ground-text-unreadable', severity: 'warn' as const,
      message: `no ink reads at 4.5:1 on the authored table ground ${[...unreadable].map(([ground, ratio]) => `${ground} (${ratio.toFixed(2)}:1)`).join(', ')}, so its text prints in the ink that reads best`,
      suggest: 'choose table.grounds further from mid-grey, lighter or darker',
    }] : []),
  ];
}

/** Regenerate only warnings whose truth depends on the active paint theme. */
export function resolvePaintWarnings(theme: Theme, rules: readonly PaintWarningRule[]): LintWarning[] {
  return rules.flatMap((rule): LintWarning[] => {
    if (rule.kind === 'series-adjacent-similar') return resolveAdjacentSeriesWarningRule(rule, theme);
    if (rule.kind === 'highlight-reads-as-loss') return highlightPaintWarnings(theme, rule.chart);
    if (rule.kind === 'bullet-band-lightness') {
      const warnings: LintWarning[] = [];
      bulletBandPaints(theme, rule.count, rule.poor, rule.good, warnings, rule.light === true);
      return warnings;
    }
    if (rule.kind === 'line-band-authored-contrast') return lineBandAuthoredWarnings(theme, rule.base, rule.seriesId, rule.authoredSource, rule.authored);
    if (rule.kind === 'others-shade-unavailable') return othersShadeUnavailableWarnings(theme, rule.base);
    if (rule.kind === 'mark-lost-on-band') return markLostOnBandWarnings(theme, rule.pairs);
    if (rule.kind === 'table-ground-text') return groundTextWarnings(theme, rule.texts);
    if (rule.kind === 'pie-ramp-crowded') {
      const base = paintColor(theme, rule.base);
      const ramp = pieRamp(base, theme.color.background, rule.count, rule.withOthers ? paintTokenColor(theme, 'othersMark') : undefined, rule.othersShade !== 'apart', theme.marks?.contrastEdge !== true);
      return ramp.distinguishableCount < rule.count ? [{
        code: rule.kind,
        severity: 'warn',
        message: `${rule.count} slices exceed the ${ramp.distinguishableCount} distinguishable tint steps of '${base}'; adjacent slices may read alike — group small slices into 'Others'`,
      }] : [];
    }
    const background = theme.color.background;
    const floor = contrastRatio(background, '#FFFFFF') > contrastRatio(background, '#000000') ? 3 : 1.4;
    const sunk = rule.options.flatMap((option) => {
      const token = paintColor(theme, option.paint);
      const amount = visibleTintAmount(theme, {
        kind: 'visible-tint', base: option.paint, amount: option.amount, floor: 'mark',
      });
      return amount === 0 && contrastRatio(token, background) < floor
        ? [`'${option.label}' (${token}, ${contrastRatio(token, background).toFixed(2)}:1)`]
        : [];
    });
    return sunk.length ? [{
      code: rule.kind,
      severity: 'warn',
      message: `the theme's tone for ${sunk.join(', ')} does not reach ${floor}:1 on the background '${background}', so it is drawn at full strength and may still be hard to see`,
      suggest: "separate color.bad / color.good / color.neutral from color.background in the theme — a response option the reader cannot see is a missing mark, not a subtle one",
    }] : [];
  });
}

/** Preserve ordinary warnings and the original insertion points of managed warnings. */
/** The warning codes the paint rules write; every other warning is ordinary and counts in a rule's `before`. */
const managedCodes = (rules: readonly PaintWarningRule[]): Set<string> => new Set(rules.flatMap((rule) => rule.kind === 'bullet-band-lightness' ? ['band-lightness-insufficient']
  : rule.kind === 'table-ground-text' ? ['table-tone-text-unreadable', 'table-ground-text-unreadable'] : [rule.kind]));

/**
 * Drop warnings after layout and keep each paint rule in its slot: a rule's `before` counts the
 * ordinary warnings ahead of it, so a dropped one ahead of it lowers the count. Without this a
 * repaint put the rule's warning later than a fresh layout in the new theme does.
 */
export function dropWarnings(geo: { warnings: LintWarning[]; paintWarningRules?: PaintWarningRule[] }, keep: (warning: LintWarning) => boolean): void {
  const rules = geo.paintWarningRules;
  if (rules?.length) {
    const managed = managedCodes(rules);
    const ordinary = geo.warnings.filter((warning) => !managed.has(warning.code));
    geo.paintWarningRules = rules.map((rule) => ({ ...rule, before: rule.before - ordinary.slice(0, rule.before).filter((warning) => !keep(warning)).length }));
  }
  geo.warnings = geo.warnings.filter(keep);
}

export function refreshPaintWarnings(
  warnings: readonly LintWarning[],
  rules: readonly PaintWarningRule[],
  theme: Theme,
): LintWarning[] {
  const managed = managedCodes(rules);
  const ordinary = warnings.filter((warning) => !managed.has(warning.code));
  const result: LintWarning[] = [];
  for (let i = 0; i <= ordinary.length; i++) {
    for (const rule of rules) {
      if (Math.min(rule.before, ordinary.length) === i) result.push(...resolvePaintWarnings(theme, [rule]));
    }
    if (i < ordinary.length) result.push(ordinary[i]!);
  }
  return result;
}
