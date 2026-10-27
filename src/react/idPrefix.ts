import { createContext, useContext, useId } from 'react';

/** The rule core's `ID_SCOPE_PATTERN` applies to `idScope`: the prefix is pasted into an id. */
const ID_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** The `idPrefix` of the chart component this element renders in. */
export const IdPrefixContext = createContext<string | undefined>(undefined);

/** The prop, refused before it reaches an id when it could break one. */
export function checkedIdPrefix(idPrefix: string | undefined): string | undefined {
  if (idPrefix !== undefined && !ID_PREFIX_PATTERN.test(idPrefix)) {
    throw new Error(`idPrefix '${idPrefix}' must match ${ID_PREFIX_PATTERN.source} (it is pasted into an id)`);
  }
  return idPrefix;
}

/**
 * `useId` behind the chart's `idPrefix`, in the characters an id and a
 * `url(#…)` reference take. Two React roots that render separately (islands,
 * one `renderToString` per chart) count `useId` from the same start, so their
 * description and pattern ids collided; a prefix per root keeps them apart.
 * A component that provides the prefix passes its own `idPrefix`: the
 * provider it renders does not reach its own hooks.
 */
export function useScopedId(own?: string): string {
  const inherited = useContext(IdPrefixContext);
  const prefix = own ?? inherited;
  const id = useId();
  return (prefix === undefined ? id : `${prefix}-${id}`).replace(/[^A-Za-z0-9_-]/g, '_');
}
