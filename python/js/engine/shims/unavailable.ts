/** The one error every shimmed Node call throws: the Python engine works in memory only. */
export function unavailable(name: string): never {
  throw new Error(`${name} is not available in the Python engine; Python passes rows inline and writes files itself`);
}
