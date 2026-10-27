import type { Theme } from '../core/types/theme';
import { interactionTokens } from '../core/a11y/theme';

/**
 * Accessible paint rules for the hover surface.
 *
 * Forced-colors mode replaces the chart palette with system colors, so a mark
 * and its outline can collapse into one tone. These rules keep the focused
 * mark's outline and the label-card hairline visible by asking the browser not
 * to adjust them, and they take their widths from the existing theme tokens
 * (`pattern.outlineStrokeWidth`, `interaction.outlineWidth`) instead of
 * introducing new numbers. `prefers-contrast: more` thickens the same outline
 * through the same tokens. No geometry is involved and the static SVG is
 * untouched.
 *
 * The chart outline and the portalled card take no pointer events. The
 * pointer reaches the chart under the card. Cut text remains available in
 * the tooltip's label and the chart's accessible description.
 */
export function a11ySurfaceStyle(theme: Theme): string {
  const outline = interactionTokens(theme).outlineWidth;
  const strong = strongOutline(theme);
  const focus = '[data-bp-hover] [data-part="interaction-outline"]';
  const card = '.bp-interaction-card [data-part="interaction-card"]';
  const surface = ':is([data-bp-hover],.bp-interaction-card)';
  const rules = [
    // The keyboard stop: a ring around the chart, and the focused record's outline drawn as strong as the contrast rule draws it.
    // The stylesheet is shared by every chart on the page: each chart sets its own ring colour and width (`keyRingStyle`).
    '[data-bp-keys]:focus{outline:none}',
    '[data-bp-keys]:focus-visible{outline:var(--bp-key-width) solid var(--bp-key-ring);outline-offset:calc(-1 * var(--bp-key-width))}',
    '[data-bp-keyed] [data-part="interaction-outline"]{stroke-width:var(--bp-key-width)}',
    '.bp-interaction-card>svg{border-radius:inherit;overflow:hidden}',
    '.bp-interaction-card :is(text,tspan){font-variant-numeric:tabular-nums!important}',
    '[data-bp-hover] [data-part^="interaction-"]{pointer-events:none}',
    '@keyframes bp-chart-card-in{from{opacity:0}}',
    '@media (prefers-reduced-motion:reduce){[data-bp-chart-card]{animation:none!important}}',
    '@media (forced-colors: active){',
    ':is(.bp-interaction-card,.bp-interaction-card-slot){background:Canvas!important;box-shadow:none!important}',
    `${surface} svg>rect:not([data-id]){fill:Canvas}`,
    `${surface} :is(text,tspan){fill:CanvasText}`,
    `${card}{forced-color-adjust:none;fill:Canvas;stroke:CanvasText}`,
    '.bp-interaction-card [data-part="interaction-swatch"]{forced-color-adjust:none;fill:CanvasText}',
    '.bp-interaction-card [data-part="interaction-mark"]{stroke:CanvasText}',
    `${focus}{forced-color-adjust:none;stroke:CanvasText;stroke-width:${outline}px}`,
    '}',
    '@media (prefers-contrast: more){',
    `${focus}{stroke-width:${strong}px}`,
    '}',
  ];
  return rules.join('');
}

/** The outline width of a contrast-mode or keyboard-focused mark: theme tokens only. */
function strongOutline(theme: Theme): number {
  return Math.max(theme.pattern.outlineStrokeWidth, interactionTokens(theme).outlineWidth * 2);
}

/** The keyboard ring of one chart, in its own theme, for the element that carries `data-bp-hover`. */
export function keyRingStyle(theme: Theme): Record<string, string> {
  return { '--bp-key-ring': theme.color.ink, '--bp-key-width': `${strongOutline(theme)}px` };
}
