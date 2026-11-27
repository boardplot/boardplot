/**
 * The JSON forms of a prepared chart and of its keys. A module of its own, so an entry that only serializes or parses
 * does not load the rest of the prepared value.
 */

/** Sorted JSON also rejects values that would silently change during transport. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' ||
        (typeof item === 'number' && !Number.isFinite(item))) {
      throw new Error('Prepared charts require JSON-safe request and render values.');
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]]));
    }
    return item;
  });
}

/** 64-bit FNV-1a over the UTF-8 bytes, as 16 hex digits. */
export function fnv64(json: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(json)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
