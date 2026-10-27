import { emphasisWeight } from '../theme';
/**
 * The text roles of a card: kpi and waffle. The label over the figure is the
 * eyebrow, and the headline is the figure. Nothing here sets a
 * size: a theme that restyles `type.eyebrow`, `type.figure` or the hero size
 * restyles every card with it.
 */

import type { FontSpec } from '../text';
import { scaleTextPx } from '../target';
import type { Theme } from '../types/theme';

/** The label role at 13 px (times `textScale`) or more, unless `type.eyebrow` sets size, weight, line height or tracking. */
export function eyebrowFont(theme: Theme, textScale = 1): FontSpec {
  const base: FontSpec = { family: theme.type.family, ...theme.type.label, size: Math.max(scaleTextPx(13, textScale), theme.type.label.size) };
  const eyebrow = theme.type.eyebrow;
  if (eyebrow === undefined) return base;
  const size = eyebrow.size ?? base.size;
  return {
    ...base,
    size,
    weight: eyebrow.weight ?? base.weight,
    ...(eyebrow.lineHeight !== undefined ? { lineHeight: eyebrow.lineHeight } : {}),
    ...(eyebrow.tracking ? { letterSpacing: eyebrow.tracking * size } : {}),
  };
}

/** Family and weight of the big figure; absent, the figure keeps `type.family` at 700. */
export function figureRole(theme: Theme): { family: string; weight: number } {
  return { family: theme.type.figure?.family ?? theme.type.family, weight: theme.type.figure?.weight ?? emphasisWeight(theme) };
}
