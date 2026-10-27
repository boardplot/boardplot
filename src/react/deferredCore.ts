/**
 * The React half of `core/deferred`: the store a chart component reads to
 * know a deferred core module landed, and the effect that fetches the one a
 * render asked for.
 *
 * The server holds nothing it did not link: `getServerSnapshot` is a
 * constant, so the server pass and the client pass that hydrates it read the
 * same store. What decides the markup is not this number but whether the
 * module is there — an entry whose graph holds it draws the chart in both
 * passes, exactly as before.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { deferredFailure, deferredRevision, loadDeferred, onDeferred, type DeferredName } from '../core/deferred';

const serverRevision = () => 0;

/** Changes when a deferred core module lands, so the layout memos recompute. */
export function useDeferredRevision(): number {
  return useSyncExternalStore(onDeferred, deferredRevision, serverRevision);
}

/**
 * Fetches the module this render asked for, and returns why its last load
 * failed. No dependency list, as in `react/spec`: a render that still lacks
 * the module asks again, so a load that failed once is tried a second time.
 * `loadDeferred` announces the same failure only once, which is what ends the
 * sequence there rather than in a loop. The chart shows the failure instead
 * of the busy placeholder, which it otherwise kept for good.
 */
export function useDeferredModule(name: DeferredName | undefined): string | undefined {
  // Every caller waits on this store, including wrappers such as DimSwitchChart
  // that do not resolve a chart request until the option refusal is ready.
  useDeferredRevision();
  useEffect(() => {
    if (name !== undefined) loadDeferred(name);
  });
  return name === undefined ? undefined : deferredFailure(name);
}
