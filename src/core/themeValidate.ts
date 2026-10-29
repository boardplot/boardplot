/** JSON parsing for external themes. */

import type { LintWarning } from './types/scene';
import type { Theme } from './types/theme';
import { validateTheme } from './themeRules';
import { parseThemeShape, unknownThemeKeyRepair } from './themeShape';
import { NormalizeError } from './normalize/shared';
import { themeColors } from './themeColors';
import { colorVariableWarnings } from './colorVariables';
import { retiredThemeKeyWarning, withoutRetiredThemeKeys } from './retired';

export * from './themeRules';
export * from './themeFields';

/**
 * Parse + register-ready: throws on schema errors, returns theme + lints. The
 * refusal is an `invalid-theme` NormalizeError; an unknown key carries the
 * suggest and remove patch the spec surfaces give, rooted at the theme file.
 * A retired key, such as space.barGap, is dropped and warns with that patch.
 */
export function parseThemeJson(raw: unknown): { theme: Theme; warnings: LintWarning[] } {
  const retired = withoutRetiredThemeKeys(stripGuide(raw));
  const { issues, theme: value } = parseThemeShape(retired.theme);
  if (issues.length) {
    const repair = unknownThemeKeyRepair(issues, '');
    throw new NormalizeError('invalid-theme', 'theme', `theme schema errors:\n${issues.map((issue) => `  ${issue}`).join('\n')}`, repair?.suggest ?? 'Use each field type and accepted value named in the theme schema errors.', repair?.fix);
  }
  const theme = themeColors(value as Theme);
  return { theme, warnings: [...retired.found.map(dotted => retiredThemeKeyWarning(dotted, [])), ...colorVariableWarnings(undefined, value, ['theme']), ...validateTheme(theme)] };
}

/** Scaffold/docs use a top-level `_guide` block — ignore it structurally. */
function stripGuide(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && '_guide' in (raw as Record<string, unknown>)) {
    const { _guide, ...rest } = raw as Record<string, unknown>;
    void _guide;
    return rest;
  }
  return raw;
}
