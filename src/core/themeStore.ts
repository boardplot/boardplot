/**
 * Themes a spec brought along as full token objects (core/doc/themeObject),
 * keyed by name plus a hash of their tokens. They stay out of the `themes`
 * registry, so discovery and error messages never show them, and the store is
 * bounded: the least recently used theme goes first. Not a public export.
 */
import type { Theme } from './types/theme';

/** How many adopted themes stay resolvable at once. */
export const ADOPTED_THEME_LIMIT = 64;

const adopted = new Map<string, Theme>();

/** Keep a theme under its content-addressed name, as the most recently used. */
export function adoptTheme(theme: Theme): void {
  adopted.delete(theme.name);
  adopted.set(theme.name, theme);
  while (adopted.size > ADOPTED_THEME_LIMIT) adopted.delete(adopted.keys().next().value!);
}

/** An adopted theme by name; a hit counts as a use. */
export function adoptedTheme(name: string): Theme | undefined {
  const theme = adopted.get(name);
  if (theme) adoptTheme(theme);
  return theme;
}

/** How many adopted themes are held now. */
export function adoptedThemeCount(): number {
  return adopted.size;
}
