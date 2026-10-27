import { themeGeometryTokens } from '../core/themeGeometry';
import type { ResolvedChartRequest } from '../core/request';
import { resolveThemeRequest } from './themeRequest';
import { scenePaint } from './scenePaint';
import { repaintGeometry, repaintScene } from '../core/repaintGeometry';
import { useContext, type ReactNode } from 'react';
import { BoardplotThemeContext, type BoardplotThemeOptions } from './themeContext';
import { useStableValue } from './useStableValue';

export interface BoardplotThemeProps extends BoardplotThemeOptions {
  children?: ReactNode;
}

/** Nested providers inherit omitted settings. Each chart owns its CSS variables. */
export function BoardplotTheme({ children, ...options }: BoardplotThemeProps) {
  const parent = useContext(BoardplotThemeContext);
  const supplied = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const suppliedStrings = Object.fromEntries(Object.entries(options.strings ?? {}).filter(([, value]) => value !== undefined));
  const strings = useStableValue({ ...parent?.strings, ...suppliedStrings });
  const value = useStableValue({ ...parent, ...supplied, strings, resolve: resolveThemeRequest, repaint: repaintGeometry, repaintScene, layoutKey, scenePaint });
  return <BoardplotThemeContext.Provider value={value}>{children}</BoardplotThemeContext.Provider>;
}

export { useBoardplotTheme } from './themeContext';
export type { BoardplotThemeOptions, BoardplotStrings } from './themeContext';

/** Provider-only invalidation inputs stay out of standalone chart bundles. */
function layoutKey(request: ResolvedChartRequest, settings: BoardplotThemeOptions): string {
  const palette = (request.options as { palette?: string }).palette;
  return JSON.stringify({
    theme: themeGeometryTokens(request.theme, request.target),
    palette: palette ? request.theme.color.palettes?.[palette]?.length : undefined,
    locale: request.locale ?? settings.locale,
    strings: settings.strings,
    density: settings.density,
  }, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
