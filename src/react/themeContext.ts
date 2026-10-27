import { createContext, useContext, type CSSProperties } from 'react';
import { localeStrings } from '../core/strings/ui';
import type { Size } from '../core/geometry';
import type { scenePaint } from './scenePaint';
import type { repaintGeometry, repaintScene } from '../core/repaintGeometry';
import type { RequestContext, ResolvedChartRequest, ChartRequest } from '../core/request';
import { DEFAULT_TARGET } from '../core/target';
import type { ReaderStrings } from '../core/readerStrings';
import type { StringsSpec } from '../core/types/options';

export type BoardplotStrings = StringsSpec & ReaderStrings & {
  /** Host wording for the space-refusal placeholder; outside the chart option block. */
  refusalMessage?: string;
  /** Host wording for a chart with nothing to draw (no categories, series, rows or points). */
  emptyMessage?: string;
  loading?: string;
};

export interface BoardplotThemeOptions extends RequestContext {
  /** auto shows full diagnostics outside production; reader keeps technical details out of the card. */
  diagnostics?: 'auto' | 'full' | 'reader';
  /** Reading direction of HTML controls and cards. Chart geometry stays in layout coordinates. */
  direction?: 'ltr' | 'rtl';
  /** System preference is the default. Motion remains static until enabled by a chart. */
  motion?: 'system' | 'reduce' | 'full';
  /** Comfortable preserves existing spacing. Compact scales pad and row-pitch tokens. */
  density?: 'comfortable' | 'compact';
  /** Built-in wording shared by the host. Authored chart text is never translated. */
  strings?: BoardplotStrings;
}

export const BoardplotThemeContext = createContext<(BoardplotThemeOptions & {
  resolve: (request: ChartRequest, settings: BoardplotThemeOptions) => ResolvedChartRequest;
  repaint: typeof repaintGeometry;
  repaintScene: typeof repaintScene;
  layoutKey: (request: ResolvedChartRequest, settings: BoardplotThemeOptions) => string;
  scenePaint: typeof scenePaint;
}) | undefined>(undefined);

/** Minimal fallback wording when the reader chunk cannot load. */
export const DEFAULT_LOAD_FAILED_TEXT = localeStrings().loadingFailed;

/** Loading and reader frames use the SVG's responsive sizing rule. */
export function placeholderStyle(size: Size, fixedSize?: boolean): CSSProperties {
  return {
    width: fixedSize ? size.width : '100%', maxWidth: size.width,
    aspectRatio: size.width / size.height, overflow: 'auto',
  };
}
const defaults = { target: DEFAULT_TARGET, direction: 'ltr', motion: 'system', density: 'comfortable', strings: {} } as const;

/** Read inherited settings without measuring, laying out, or touching the DOM. */
export function useBoardplotTheme(): BoardplotThemeOptions & { direction: 'ltr' | 'rtl'; motion: NonNullable<BoardplotThemeOptions['motion']>; density: NonNullable<BoardplotThemeOptions['density']>; strings: BoardplotStrings } {
  const value = useContext(BoardplotThemeContext);
  const { resolve: _resolve, repaint: _repaint, repaintScene: _repaintScene, layoutKey: _layoutKey, scenePaint: _scenePaint, ...settings } = value ?? {};
  return { ...defaults, ...settings, strings: { ...defaults.strings, ...value?.strings } };
}
