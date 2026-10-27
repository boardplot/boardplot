import { useRef } from 'react';
import type { ResolvedChartRequest } from '../core/request';
import { assertPreparedRequest, type PreparedHeader } from './prepared';

/**
 * Keep a server snapshot only while its original layout inputs remain current.
 *
 * `request` is undefined while the component waits for a core module it
 * fetches on demand (see `core/deferred`). There is no request to match a
 * snapshot against then — and matching against a stand-in would reject a
 * snapshot that was prepared correctly — so the check waits with it.
 */
export function usePrepared<T extends PreparedHeader & { kind: string }>(
  prepared: T | undefined, request: ResolvedChartRequest | undefined, kind: T['kind'], fit?: PreparedHeader['fit'],
): T | undefined {
  const initial = useRef<{ prepared: T; request: ResolvedChartRequest; fit?: PreparedHeader['fit'] } | undefined>(undefined);
  if (!prepared) initial.current = undefined;
  else if (!request) return undefined;
  else if (prepared !== initial.current?.prepared) {
    if (prepared.kind !== kind) throw new Error(`Expected a prepared ${kind} chart.`);
    assertPreparedRequest(prepared, request);
    if (prepared.fit !== fit) throw new Error('Prepared chart container fit does not match.');
    initial.current = { prepared, request, fit };
  }
  return initial.current?.request === request && initial.current?.fit === fit ? prepared : undefined;
}
