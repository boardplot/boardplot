/**
 * The keys of the built-in word tables, for the one check that refuses a misspelt `options.strings` key.
 * A browser never links the list (about 5 kB gzip in every chart); the Node entries (CLI, MCP, validate,
 * server rendering) link it with `linkWordKeys`. Without the list a key is accepted, and the layout ignores
 * a key it does not read.
 */
let keys: ReadonlySet<string> | undefined;

/** The linked keys, or undefined where no list is linked. */
export function linkedWordKeys(): ReadonlySet<string> | undefined {
  return keys;
}

export function setWordKeys(list: readonly string[]): void {
  keys ??= new Set(list);
}
