import { useEffect, useState } from 'react';

/** How long a container's size must hold still before a size refusal shows. */
const SETTLE_MS = 120;

/**
 * Whether a size-dependent refusal still waits. A host that is still growing passes through sizes the chart
 * refuses: the busy box stands in, and no finding goes out, until the container's size holds still for
 * SETTLE_MS; a refusal then shows at once. A new size or a new refusal (`subject`) starts the wait again.
 * The server and the first hydration render (`client` false) already show the refusal; it stays held until its
 * inputs change.
 */
export function useRefusalSettle(refused: boolean, client: boolean, sizeKey: string, subject: unknown): boolean {
  const [state, setState] = useState(() => ({ sizeKey, subject, held: !client }));
  const current = state.sizeKey === sizeKey && state.subject === subject;
  if (!current) setState({ sizeKey, subject, held: false });
  useEffect(() => {
    if (!refused || state.held) return undefined;
    const timer = setTimeout(() => setState({ ...state, held: true }), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [refused, state]);
  return client && refused && (!current || !state.held);
}
