import { useContext, useMemo, type ReactElement } from 'react';
import { asFirstFrame } from '../core/deferred';
import { ENGINE_REV } from '../core/engine';
import { resolveTargetTheme, themes } from '../core/theme';
import type { RenderTarget } from '../core/types/options';
import type { Theme, ThemeRef } from '../core/types/theme';
import { checkedIdPrefix, IdPrefixContext } from './idPrefix';
import { preparedInputKey, preparedResult } from './preparedInput';
import { SceneRenderer } from './SceneRenderer';
import { LayoutRefusal, SizePlaceholder, type PlaceholderFrame } from './SizePlaceholder';
import { BoardplotThemeContext } from './themeContext';
import { ScaleGroupContext } from './scaleGroupContext';
import type { BoardplotChartProps } from './spec';

/** The first frame reports nothing: the chart that replaces it calls the host's onRefused once. */
const quiet = () => {};

/**
 * A prepared chart as `prepareChart` laid it out, drawn from the prepared value alone. `BoardplotChart` shows it in the
 * server pass, in the pass that hydrates it and until the chunks of the chart type have loaded; the chart of the type
 * then takes its place with the same drawing. Undefined when this pass cannot draw it: no prepared SVG chart, a value
 * of another engine revision, an input key that is not the key of these props (the prepared chart belongs to another
 * spec or other settings), a dimswitch (it draws as a table), a chart in a `ScaleGroup` (the group's shared scale is
 * not in the prepared value), a story (its step is not either), or a theme that needs a module the page has not loaded.
 */
export function usePreparedFirstFrame(spec: unknown, props: BoardplotChartProps, frame: PlaceholderFrame & { theme?: Theme | ThemeRef }): ReactElement | undefined {
  const { prepared, size, fit, fallbackSize, rows, columns, theme: hostTheme, target: hostTarget, fixedSize, idPrefix } = props;
  const context = useContext(BoardplotThemeContext);
  const grouped = useContext(ScaleGroupContext) !== undefined;
  const story = (props as { storyLink?: unknown }).storyLink !== undefined;
  const candidate = !grouped && !story && prepared?.kind === 'svg' && prepared.engineRev === ENGINE_REV && prepared.result.type !== 'dimswitch' ? prepared : undefined;
  const host = { theme: hostTheme, target: hostTarget, size, fit, fallbackSize, rows, columns };
  const matches = useMemo(() => !!candidate?.inputKeys?.includes(preparedInputKey(spec, host, context, themes)!),
    // The host props count by their values, so a new props object with the same values keeps the result.
    [candidate, spec, context, ...Object.values(host)]);
  const chart = matches ? candidate : undefined;
  const target = frame.options?.target as RenderTarget;
  const theme = useMemo(() => {
    if (!chart) return undefined;
    if (chart.theme) return chart.theme;
    // Only what every page links counts in this frame, so the server and the browser resolve the same theme.
    try { return asFirstFrame([], () => resolveTargetTheme(frame.theme as ThemeRef | undefined, target)); }
    catch { return undefined; }
  }, [chart, frame.theme, target]);
  const result = useMemo(() => chart && preparedResult(chart), [chart]);
  if (!result || !theme) return undefined;
  const body = result.refused ? <SizePlaceholder {...frame} fixedSize={fixedSize} result={result} theme={theme} renderRefused={props.renderRefused} onRefused={quiet} />
    : result.refusals?.length ? <LayoutRefusal {...frame} fixedSize={fixedSize} refusals={result.refusals} theme={theme} size={result.size} />
    // The chart's own wrapper: the drawing never grows past its laid-out width, except a container chart that fills its host.
    : <div style={{ position: 'relative', maxWidth: chart!.fit === 'fill' && result.sizing?.fit !== 'content' ? undefined : result.size.width }}>
      <SceneRenderer geometry={result} theme={theme} responsive={!fixedSize} />
    </div>;
  return idPrefix === undefined ? body : <IdPrefixContext.Provider value={checkedIdPrefix(idPrefix)}>{body}</IdPrefixContext.Provider>;
}
