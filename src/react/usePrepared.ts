import { useRef } from 'react';
import type { ResolvedChartRequest } from '../core/request';
import { resolveTargetSize } from '../core/target';
import type { Size } from '../core/geometry';
import { assertPreparedRequest, type PreparedHeader } from './prepared';

/**
 * Keep a server snapshot only while its original layout inputs remain current.
 *
 * `request` is undefined while the component waits for a core module it
 * fetches on demand (see `core/deferred`). There is no request to match a
 * snapshot against then — and matching against a stand-in would reject a
 * snapshot that was prepared correctly — so the check waits with it.
 *
 * A container snapshot is laid out at the fallback frame (`fallback`), so a new one is checked against the
 * request at that frame. After the container measured another size the snapshot no longer fits the request,
 * and the chart lays out at the measured size.
 */
export function usePrepared<T extends PreparedHeader & { kind: string }>(
  prepared: T | undefined, request: ResolvedChartRequest | undefined, kind: T['kind'], fit?: PreparedHeader['fit'], fallback?: Size,
): T | undefined {
  const initial = useRef<{ prepared: T; request: ResolvedChartRequest; fit?: PreparedHeader['fit'] } | undefined>(undefined);
  if (!prepared) initial.current = undefined;
  else if (!request) return undefined;
  else if (prepared !== initial.current?.prepared) {
    if (prepared.kind !== kind) throw new Error(`Expected a prepared ${kind} chart.`);
    const frame = fallback && (request.size.width !== fallback.width || request.size.height !== fallback.height) ? resolveTargetSize(request.target, fallback) : undefined;
    const framed = frame ? { ...request, size: frame.sizePx, fixed: frame.fixed, options: { ...request.options, size: fallback } } : request;
    assertPreparedRequest(prepared, framed);
    if (prepared.fit !== fit) throw new Error('Prepared chart container fit does not match.');
    initial.current = { prepared, request: framed, fit };
  }
  return initial.current?.request === request && initial.current?.fit === fit ? prepared : undefined;
}
