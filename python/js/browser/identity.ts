/** The build identity the asset build injects (engine distribution identity plus the frontend protocol). */
export interface BuildIdentity {
  version: string;
  frontendProtocol: number;
  /** Hash of the sources under python/js/. */
  pythonSources?: string;
  [key: string]: unknown;
}

declare const __BOARDPLOT_IDENTITY__: BuildIdentity;

export const identity: BuildIdentity = __BOARDPLOT_IDENTITY__;

/** Two builds match when the engine identity, the Python-side sources and the message protocol are the same. */
export function sameIdentity(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Partial<BuildIdentity>;
  const y = b as Partial<BuildIdentity>;
  return typeof x.version === 'string' && x.version === y.version && x.frontendProtocol === y.frontendProtocol
    && x.pythonSources === y.pythonSources;
}
