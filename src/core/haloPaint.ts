import { contrastRatio } from './color';
import { resolvePaint } from './svg/paint';
import type { Paint } from './types/scene';
import type { Theme } from './types/theme';

/** Preserve the page halo when readable; otherwise select a contrasting theme ink. */
export function haloPaint(ink: Paint, theme: Theme): Paint {
  const color = resolvePaint(ink, theme);
  let token: 'background' | 'ink' | 'inkInverse' = 'background';
  let contrast = contrastRatio(color, theme.color.background);
  if (contrast >= 4.5) return { token };
  for (const candidate of ['ink', 'inkInverse'] as const) {
    const next = contrastRatio(color, theme.color[candidate]);
    if (next > contrast) { token = candidate; contrast = next; }
  }
  return { token };
}
