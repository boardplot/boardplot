/**
 * How a printed number names its claim. A label request carries the ids of the claims it
 * prints (`LabelRequest.claimIds`), and the reading takes their `displayed` text from that
 * label. A chart that draws through another chart (pvm through waterfall) names the claims
 * of the delegate's labels with `HOST_CLAIMS`, so the delegate never knows the host's ids.
 */

import type { Id, OwnerRef } from '../types/cell';
import type { LabelKind } from '../types/options';

/**
 * One claim id: a fixed prefix, then its parts joined by ':'. A part escapes '\' and ':'
 * with '\', so 'a' + 'b:c' and 'a:b' + 'c' stay two ids. A part without either keeps its bytes.
 */
export function claimId(prefix: string, ...parts: (string | number)[]): string {
  return [prefix, ...parts.map((part) => String(part).replace(/[\\:]/g, '\\$&'))].join(':');
}

/** What a host reads of a delegate's label request to name its claims. */
export interface ClaimedRequest {
  id: Id;
  kind: LabelKind;
  owner: OwnerRef;
  claimIds?: readonly Id[];
}

/**
 * Internal option, set by a host chart on the options it hands its delegate: the claims each
 * of the delegate's labels prints, decided from the request's kind and owner. Under a host it
 * replaces the delegate's own `claimIds`; `undefined` names none.
 */
export const HOST_CLAIMS = Symbol('boardplot.hostClaims');
export type HostClaims = (request: ClaimedRequest) => readonly Id[] | undefined;

/** The claims a label request prints: the host's answer where a host names them, else the request's own. */
export function requestClaims(request: ClaimedRequest, options: object): readonly Id[] | undefined {
  const host = (options as { [HOST_CLAIMS]?: HostClaims })[HOST_CLAIMS];
  return host ? host(request) : request.claimIds;
}

/**
 * Internal geometry field: claims the chart computes and decided not to print (a residual, a
 * value the author turned off). The number census accepts these as unbound; any other claim
 * of a type that names its claims at the request must reach a label or a text node.
 */
export const UNPRINTED_CLAIMS = Symbol('boardplot.unprintedClaims');

export function unprintedClaims(geometry: object): readonly Id[] {
  return (geometry as { [UNPRINTED_CLAIMS]?: readonly Id[] })[UNPRINTED_CLAIMS] ?? [];
}

/** The geometry with these claims added to the ones it does not print. */
export function withUnprintedClaims<G extends object>(geometry: G, ids: readonly Id[]): G {
  return ids.length === 0 ? geometry : { ...geometry, [UNPRINTED_CLAIMS]: [...unprintedClaims(geometry), ...ids] };
}
