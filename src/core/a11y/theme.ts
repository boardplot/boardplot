import type { Theme } from '../types/theme';

interface InteractionTokens {
  /** 'linear', 'ease-out', or a theme's own ease-out `cubic-bezier(...)` curve. */
  easing: string;
  dim: number;
  outlineWidth: number;
  hoverIntent: number;
  fade: number;
  travel: number;
  /** Duration of layout transitions (rows opening, columns appearing). */
  layout: number;
  cardRadius: number;
  cardHairline: string;
}

/** Host interaction paint and timing values. These tokens never affect SVG layout. */
export function interactionTokens(theme: Theme): InteractionTokens {
  return {
    easing: theme.motion?.easing ?? 'ease-out',
    dim: theme.interaction?.dim ?? 0.25,
    outlineWidth: theme.interaction?.outlineWidth ?? 1,
    hoverIntent: theme.motion?.hoverIntent ?? 80,
    fade: theme.motion?.fade ?? 120,
    travel: theme.motion?.travel ?? 160,
    layout: theme.motion?.layout ?? 160,
    cardRadius: theme.surface?.chipRadius ?? 2,
    cardHairline: theme.color.axis,
  };
}
