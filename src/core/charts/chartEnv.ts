/** The opening steps most chart layouts share: the theme at the chart's width, the palette, the break warning. */

import { resolveSize } from '../normalize/shared';
import { paletteWarning, panelTypeClass, resolvePalette, resolveTheme, themeForWidth } from '../theme';
import type { BaseOptions } from '../types/options';
import type { LintWarning } from '../types/scene';
import type { Theme } from '../types/theme';

/** The theme at the chart's type class: a grid panel's class, else the authored width. */
export function chartTheme(options: Pick<BaseOptions, 'theme' | 'size'>): Theme {
  return themeForWidth(resolveTheme(options.theme), panelTypeClass(options) ?? resolveSize(options.size).width);
}

/** The palette ramp; a palette the theme cannot use warns. */
export function chartPalette(theme: Theme, palette: string | undefined, warnings: LintWarning[]): ReturnType<typeof resolvePalette> {
  return resolvePalette(theme, palette, (code, message) => warnings.push(paletteWarning(code, message)));
}

/**
 * The warning of a type that draws no axis break. The schema refuses the
 * break first; React callers skip the schema and get this warning.
 */
export function breakUnsupported(type: string, options: { valueAxis?: { break?: unknown } }, warnings: LintWarning[]): void {
  if (options.valueAxis?.break) warnings.push({ code: 'axis-break-unsupported', severity: 'warn', message: `chart type '${type}' does not support valueAxis.break — ignored` });
}
