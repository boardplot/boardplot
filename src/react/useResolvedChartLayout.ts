import { useDeferredValue, useMemo, useRef } from 'react';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import { layoutRefusal } from '../core/emptyData';
import { NormalizeError } from '../core/normalize/shared';
import { getChart } from '../core/registry';
import { asFirstFrame, DeferredCoreError, deferredFailure, type DeferredName } from '../core/deferred';
import type { ChartRequest, RequestContext, ResolvedChartRequest } from '../core/request';
import type { LayoutResult } from '../core/types/scene';
import { isFullGeometry, type PreparedChart, type RenderGeometry } from './prepared';
import { layoutContainerRequest, type ContainerFit } from './containerLayout';
import { useDeferredRevision } from './deferredCore';
import { useResolvedChartRequest } from './useResolvedChartRequest';
import { usePrepared } from './usePrepared';

interface RenderOptions {
  prepared?: PreparedChart;
  fit?: ContainerFit;
  /** The options are refused (optionRefusals): no layout runs, since one may throw on them. */
  skipLayout?: boolean;
  /** A layout that refuses (`empty-data`, a spacing floor, ...) answers with its refusal card instead of throwing, as the CLI refuses. */
  errorAsRefusal?: boolean;
  /** The fetched core modules the caller's own entry links, which its server and hydrating frames may use (`asFirstFrame`). */
  linked?: readonly DeferredName[];
  /**
   * A new layout (a new size or new data) renders in the background: the chart keeps its last drawing until the
   * new one is ready, so a resize or a page of charts never blocks the page in one long task (`useDeferredValue`).
   */
  defer?: boolean;
  /** Nothing to lay out and no request to read: the request is not resolved either (the print-only layout). */
  idle?: boolean;
}
type RenderResult = LayoutResult | RenderGeometry;

/** Every caller of useResolvedChartLayout links the fetched modules and every chart core by value (`useChartLayout`). */
const EVERY_FETCHED: readonly DeferredName[] = ['theme-rules', 'annotate', 'chart-cores'];

export function useResolvedChartLayout(input: ChartRequest, context?: RequestContext): { request: ResolvedChartRequest; geometry: LayoutResult };
export function useResolvedChartLayout(input: ChartRequest, context: RequestContext, rendering: RenderOptions): { request: ResolvedChartRequest; geometry: RenderResult };

/**
 * Shared by components and the headless hook without importing record
 * adapters. A layout that asks for a core module this bundle links on
 * demand throws here: every caller of THIS hook links both (`useChartLayout`
 * and the server entries do it statically), so the throw is a real fault.
 * The chart components call `useDeferrableChartLayout` below instead.
 */
export function useResolvedChartLayout(input: ChartRequest, context: RequestContext = {}, rendering: RenderOptions = {}) {
  const { request, geometry, deferred } = useDeferrableChartLayout(input, context, { linked: EVERY_FETCHED, ...rendering });
  if (deferred || !request) throw new DeferredCoreError(deferred ?? 'theme-rules');
  return { request, geometry: geometry as RenderResult };
}

/**
 * The same resolution, with the deferred core modules answered instead of
 * thrown: `deferred` names the module the chart is waiting for and there is
 * no geometry until it lands. A prepared chart is attached rather than laid
 * out, so it never waits.
 */
const NONE: readonly DeferredName[] = [];
/** The constant a chart that does not defer hands `useDeferredValue`, so React never schedules a background pass for it. */
const NOT_DEFERRED = {};

export function useDeferrableChartLayout(
  input: ChartRequest,
  context: RequestContext = {},
  rendering: RenderOptions = {},
): { request?: ResolvedChartRequest; geometry?: RenderResult; deferred?: DeferredName; pending?: boolean; failure?: string } {
  const { prepared, fit, skipLayout, errorAsRefusal, linked = NONE, defer = false, idle = false } = rendering;
  const current = useResolvedChartRequest(input, context, prepared, linked, idle);
  const { provider } = current;
  // Deferred: the layout reads the inputs of the last background pass. React renders the new inputs at transition
  // priority, a chart at a time, and drops a pass that a newer size or data makes stale. Mount, the server and
  // hydration read the current inputs (no initial value), so their markup is unchanged. A paint-only change (a
  // theme switch keeps the layout request) and a chart with nothing to lay out read the current inputs at once:
  // a dark card never shows a light chart, and a refusal never waits.
  const now = useMemo(() => ({ request: current.request, layoutRequest: current.layoutRequest, themeDeferred: current.deferred, skipLayout, fit }),
    [current.request, current.layoutRequest, current.deferred, skipLayout, fit]);
  const lagged = useDeferredValue(defer ? now : NOT_DEFERRED) as Partial<typeof now>;
  // A chart that turns deferral on still holds the constant until the background pass: it reads the current inputs.
  const inputs = !defer || skipLayout || lagged === NOT_DEFERRED || (lagged.layoutRequest === now.layoutRequest && lagged.fit === fit)
    ? now : lagged as typeof now;
  const { request, layoutRequest, themeDeferred } = inputs;
  const skip = inputs.skipLayout;
  // No request means no snapshot match and no layout: a chart waiting for a
  // core module has nothing to compare a prepared scene against, and a
  // stand-in would reject the snapshot that was prepared correctly.
  const shownFit = inputs.fit;
  const initial = usePrepared(prepared, layoutRequest, 'svg', shownFit);
  const revision = useDeferredRevision();
  const attempt = useMemo((): { geometry?: RenderResult; deferred?: DeferredName; failure?: string } => {
    // A refused chart lays nothing out, but its card still needs the resolved
    // theme: a patch waits on the theme checks either way.
    if (skip) return { deferred: themeDeferred };
    if (initial) return { geometry: initial.result };
    if (themeDeferred || !layoutRequest) return { deferred: themeDeferred };
    try { return { geometry: revision === 0 ? asFirstFrame(linked, () => layoutContainerRequest(layoutRequest, shownFit)) : layoutContainerRequest(layoutRequest, shownFit) }; }
    catch (error) {
      if (errorAsRefusal && error instanceof NormalizeError) {
        return { geometry: layoutRefusal(layoutRequest.type, getChart(layoutRequest.type)?.title ?? layoutRequest.type, layoutRequest.size, error) };
      }
      if (!(error instanceof DeferredCoreError)) throw error;
      return { deferred: error.module, failure: error.failure };
    }
    // `revision` is the store snapshot: a layout that asked for a deferred
    // module runs again once that module has landed.
  }, [layoutRequest, shownFit, initial, themeDeferred, revision, skip, linked]);
  // Hydration updates the module-store revision even when nothing was deferred. Keep that completed
  // layout's identity until its inputs or deferred state change, so a visible refusal stays mounted.
  const geometry = useMemo(() => attempt.geometry, [layoutRequest, shownFit, initial, themeDeferred, skip, attempt.deferred]);
  const painted = useMemo(() => geometry === undefined || geometry.refused || !provider || !request || request.theme === layoutRequest?.theme
    ? geometry : isFullGeometry(geometry)
      ? provider.repaint(geometry, request.theme, request.options)
      : { ...geometry, scene: provider.repaintScene(geometry.scene, request.theme, prepared?.paintThemes) },
  [geometry, request?.theme, layoutRequest, provider?.repaint, provider?.repaintScene, prepared]);
  // A chart that has drawn keeps its last drawing while a later layout waits for a core module
  // (an annotation added after the first draw): the busy placeholder put back over a drawn chart
  // made a host that swaps in the chart on its first draw show "Loading" again. A failed load
  // shows the failure, as before.
  // Kept after commit: a background pass that React drops never becomes the last drawing.
  const drawn = useRef<{ request: ResolvedChartRequest; geometry: RenderResult }>(undefined);
  useIsomorphicLayoutEffect(() => {
    if (painted && request) drawn.current = { request, geometry: painted };
    else if (skip) drawn.current = undefined;
  });
  const failure = attempt.deferred === undefined ? undefined : attempt.failure ?? deferredFailure(attempt.deferred);
  const waiting = !painted && attempt.deferred !== undefined && failure === undefined;
  // `pending`: a newer request is still laying out in the background.
  const pending = inputs !== now;
  if (waiting && drawn.current) return { ...drawn.current, deferred: attempt.deferred, pending };
  return { request, geometry: painted, deferred: attempt.deferred, pending, ...(failure === undefined ? {} : { failure }) };
}
