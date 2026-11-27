import { useContext, useMemo, type ReactElement } from 'react';
import { asFirstFrame } from '../core/deferred';
import { ENGINE_REV } from '../core/engine';
import { resolveTargetTheme } from '../core/theme';
import type { RenderTarget } from '../core/types/options';
import type { Theme, ThemeRef } from '../core/types/theme';
import { checkedIdPrefix, IdPrefixContext } from './idPrefix';
import { preparedResult } from './prepared';
import { preparedInputKey } from './preparedInput';
import { SceneRenderer } from './SceneRenderer';
import { LayoutRefusal, SizePlaceholder, type PlaceholderFrame } from './SizePlaceholder';
import { BoardplotThemeContext } from './themeContext';
import type { BoardplotChartProps } from './spec';

/**
 * The request that `parseChartSpec` makes of a spec with one chart, in its shape and without validation: the root's
 * theme and language tag join the chart's options, and the chart's name drops. `prepareChart` keyed that request, so a
 * chart prepared from `parseChartSpec(spec).request` matches its spec. Undefined for a document of several charts.
 */
function specRequest(spec: unknown): Record<string, unknown> | undefined {
  if (!spec || typeof spec !== 'object') return undefined;
  const root = spec as { theme?: unknown; locale?: unknown; charts?: unknown };
  const chart = (Array.isArray(root.charts) ? root.charts.length === 1 ? root.charts[0] : undefined : root) as Record<string, unknown> | undefined;
  if (!chart || typeof chart !== 'object') return undefined;
  return {
    type: chart.type, data: chart.data,
    options: {
      ...(root.theme === undefined ? {} : { theme: root.theme }),
      ...(Array.isArray(root.charts) && typeof root.locale === 'string' ? { locale: { language: root.locale } } : {}),
      ...chart.options as object,
    },
    ...(chart.annotations === undefined ? {} : { annotations: chart.annotations }),
  };
}

/** The first frame reports nothing: the chart that replaces it calls the host's onRefused once. */
const quiet = () => {};

/**
 * A prepared chart as `prepareChart` laid it out, drawn from the prepared value alone. `BoardplotChart` shows it in the
 * server pass, in the pass that hydrates it and until the chunks of the chart type have loaded; the chart of the type
 * then takes its place with the same drawing. Undefined when this pass cannot draw it: no prepared SVG chart, a value
 * of another engine revision, an input key that is not the key of these props (the prepared chart belongs to another
 * spec or other settings), a dimswitch (it draws as a table), or a theme that needs a module the page has not loaded.
 */
export function usePreparedFirstFrame(spec: unknown, props: BoardplotChartProps, frame: PlaceholderFrame & { theme?: Theme | ThemeRef }): ReactElement | undefined {
  const { prepared, size, fit, fallbackSize, rows, columns, theme: hostTheme, target: hostTarget, fixedSize, idPrefix } = props;
  const context = useContext(BoardplotThemeContext);
  const candidate = prepared?.kind === 'svg' && prepared.engineRev === ENGINE_REV && prepared.inputKey !== undefined && prepared.result.type !== 'dimswitch' ? prepared : undefined;
  const matches = useMemo(() => {
    if (!candidate) return false;
    const chart = specRequest(spec);
    return chart !== undefined && preparedInputKey({ ...chart, ...(hostTheme === undefined ? {} : { theme: hostTheme }), ...(hostTarget === undefined ? {} : { target: hostTarget }) },
      { size, fit, fallbackSize, rows, columns }, context) === candidate.inputKey;
  }, [candidate, spec, hostTheme, hostTarget, size, fit, fallbackSize, rows, columns, context]);
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
