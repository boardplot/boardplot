import type { BoardplotThemeOptions } from './themeContext';

/** The guarded read also lets bundlers replace NODE_ENV in browser builds. */
export function fullDiagnostics(mode: BoardplotThemeOptions['diagnostics']): boolean {
  if (mode && mode !== 'auto') return mode === 'full';
  try { return process.env.NODE_ENV !== 'production'; }
  catch { return true; }
}
