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

/** 64-bit FNV-1a over the UTF-8 bytes, as 16 hex digits. The 64-bit product runs on 16-bit limbs, so no BigInt is needed. */
export function fnv64(json: string): string {
  // The offset basis 0xcbf29ce484222325 as four 16-bit limbs from the low end.
  let h0 = 0x2325, h1 = 0x8422, h2 = 0x9ce4, h3 = 0xcbf2;
  for (const byte of new TextEncoder().encode(json)) {
    h0 ^= byte;
    // Times the prime 0x100000001b3 = 2^40 + 0x1b3: each limb times 0x1b3 with its carry, plus the hash shifted by 40 bits.
    const t0 = h0 * 0x1b3, t1 = h1 * 0x1b3 + (t0 >>> 16), t2 = h2 * 0x1b3 + (t1 >>> 16) + (h0 << 8), t3 = h3 * 0x1b3 + (t2 >>> 16) + (h1 << 8);
    h0 = t0 & 0xffff; h1 = t1 & 0xffff; h2 = t2 & 0xffff; h3 = t3 & 0xffff;
  }
  return [h3, h2, h1, h0].map(limb => limb.toString(16).padStart(4, '0')).join('');
}
