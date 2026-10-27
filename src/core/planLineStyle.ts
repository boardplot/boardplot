import { strokeToken } from './theme';
import type { Theme } from './types/theme';

/** plan lines share an ink outline with a background centre. */
export function planLineStyle(scenario: string | undefined, theme: Theme) {
  return scenario === 'PL'
    ? { width: strokeToken(theme, 'data'), ink: 'ink' as const }
    : undefined;
}
