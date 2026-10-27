import { useContext, useMemo } from 'react';
import { asFirstFrame, DeferredCoreError, type DeferredName } from '../core/deferred';
import { resolveChartRequest, type ChartRequest, type RequestContext, type ResolvedChartRequest } from '../core/request';
import type { ThemeRef } from '../core/types/theme';
import { requestRenderKey, type PreparedHeader } from './prepared';
import { BoardplotThemeContext } from './themeContext';
import { useDeferredModule, useDeferredRevision } from './deferredCore';
import { useStableValue } from './useStableValue';
import { AUTHORED_TYPE_SIZE } from '../core/text';

/**
 * The current paint request and the last request whose geometry inputs
 * changed — or NEITHER, while a core module the resolution needs is still
 * loading.
 *
 * `resolveTheme` runs the structural checks over a theme a caller PATCHED,
 * and a per-type React entry fetches those checks (see `core/deferred`).
 * Until they land there is no resolved request, and this hook hands out
 * none: a stand-in resolved against the default theme would be laid out,
 * measured and — worse — matched against a `prepared` snapshot that was
 * built with the real theme, which `usePrepared` would then reject. The
 * caller reads `deferred`, draws the busy placeholder, and asks again when
 * the module lands.
 *
 * The one exception is a `prepared` snapshot that carries the theme the
 * server resolved: the request is built on that theme and kept only when the
 * snapshot's key matches it, so hydration draws the server's chart while the
 * checks load in the background.
 */
export function useResolvedChartRequest(input: ChartRequest, context: RequestContext = {}, prepared?: PreparedHeader, linked: readonly DeferredName[] = [], idle = false) {
  const provider = useContext(BoardplotThemeContext);
  const options = useStableValue(input.options ?? {});
  const request = useStableValue({ ...input, options });
  const inherited = useStableValue({ ...provider, ...context });
  const revision = useDeferredRevision();
  const attempt = useMemo((): { resolved?: ResolvedChartRequest; deferred?: DeferredName; seeded?: true } => {
    if (idle) return {};
    const resolve = provider?.resolve ?? resolveChartRequest;
    try {
      // Revision 0 is the server snapshot: the server pass and the hydrating pass see only the modules the chart's entry links (`asFirstFrame`).
      return { resolved: revision === 0 ? asFirstFrame(linked, () => resolve(request, inherited)) : resolve(request, inherited) };
    } catch (error) {
      if (!(error instanceof DeferredCoreError)) throw error;
      const seeded = error.module === 'theme-rules' ? preparedThemeRequest(resolve, request, inherited, prepared) : undefined;
      return seeded ? { resolved: seeded, seeded: true } : { deferred: error.module as DeferredName };
    }
    // `revision` is not read here: it is the store snapshot that makes this
    // memo recompute once the module a failed resolve asked for has landed.
  }, [request, inherited, revision, prepared?.theme, prepared?.requestKey, linked, idle]);
  useDeferredModule(attempt.seeded ? 'theme-rules' : undefined);
  const resolved = attempt.resolved;
  // The hooks below stay unconditional, and read nothing while there is no
  // request: their keys are stable placeholders that nothing is drawn from.
  const { theme: _theme, locale: _locale, ...layoutOptions } = resolved?.options ?? ({} as Partial<ResolvedChartRequest['options']>);
  const stableLayoutOptions = useStableValue(layoutOptions);
  // By content: the checked theme that replaces a snapshot's theme once the
  // checks land is the same theme, and must not lay the chart out again.
  const theme = useStableValue(resolved?.theme);
  // Authored sizes can change layout while numeric tokens stay equal. Keep
  // that state outside comparisons and JSON keys that omit symbol properties.
  const authoredSizes = useStableValue(Object.entries(resolved?.theme.type ?? {}).flatMap(([role, font]) =>
    font !== null && typeof font === 'object' && AUTHORED_TYPE_SIZE in font ? [role] : []));
  const geometryKey = resolved === undefined ? undefined
    : provider ? provider.layoutKey(resolved, inherited) : theme;
  // By content too: every resolve writes a new locale object that carries the chart's number marks.
  const locale = useStableValue(resolved?.locale);
  const localeKey = provider ? undefined : locale;
  // Paint changes retain the original layout input. The renderer resolves the
  // symbolic scene against `resolved.theme`, including contrast paint rules.
  const layoutRequest = useMemo(() => resolved, [
    request.data, resolved?.type, resolved?.scope.chart, resolved?.scope.panel, stableLayoutOptions, geometryKey, authoredSizes, localeKey,
  ]);
  return { request: resolved, layoutRequest, provider, deferred: attempt.deferred };
}

type Resolve = (request: ChartRequest, context: RequestContext) => ResolvedChartRequest;

/**
 * The request resolved on the preset alone, then given the snapshot's theme
 * and the caller's theme reference back. Undefined unless the snapshot's key
 * matches it, which is the proof that the server resolved this very request
 * to that theme.
 */
function preparedThemeRequest(resolve: Resolve, request: ChartRequest, inherited: RequestContext, prepared?: PreparedHeader): ResolvedChartRequest | undefined {
  if (prepared?.theme === undefined) return undefined;
  // The reference `resolveChartRequest` settles on: request, then options, then inherited.
  const ref: ThemeRef | undefined = request.theme ?? (request.options as { theme?: ThemeRef } | undefined)?.theme ?? inherited.theme;
  if (typeof ref !== 'object') return undefined;
  try {
    const base = resolve({ ...request, theme: ref.preset }, inherited);
    const seeded = { ...base, theme: prepared.theme, options: { ...base.options, theme: ref } };
    return requestRenderKey(seeded) === prepared.requestKey ? seeded : undefined;
  } catch {
    // A preset this graph cannot resolve either: wait for the checks as before.
    return undefined;
  }
}
