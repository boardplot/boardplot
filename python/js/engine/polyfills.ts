/**
 * Web APIs a bare V8 isolate lacks and the engine calls: TextEncoder
 * (claims hashing), atob and btoa (font tables, geo packs, images),
 * structuredClone, performance.now and queueMicrotask. Each one is installed
 * only when the host does not have it.
 *
 * The root package.json marks every file outside its sideEffects list as
 * free of side effects, so a bare `import './polyfills'` would be dropped.
 * The entry imports `polyfills` by value instead, and as its first import,
 * so the globals exist before any engine module runs.
 */
const g = globalThis as Record<string, unknown>;
const installed: string[] = [];

/** UTF-8 bytes of a string; a lone surrogate becomes U+FFFD, as the web TextEncoder writes it. */
function utf8(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else code = 0xfffd;
    } else if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

if (typeof g.TextEncoder === 'undefined') {
  installed.push('TextEncoder');
  g.TextEncoder = class TextEncoder {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array { return utf8(String(input)); }
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

if (typeof g.btoa === 'undefined') {
  installed.push('btoa');
  g.btoa = (input: string): string => {
    const s = String(input);
    let out = '';
    for (let i = 0; i < s.length; i += 3) {
      const a = s.charCodeAt(i);
      const b = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      const c = i + 2 < s.length ? s.charCodeAt(i + 2) : 0;
      if (a > 255 || b > 255 || c > 255) throw new Error('btoa: the string holds characters outside Latin-1');
      const n = (a << 16) | (b << 8) | c;
      out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < s.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < s.length ? B64[n & 63]! : '=');
    }
    return out;
  };
}

if (typeof g.atob === 'undefined') {
  installed.push('atob');
  g.atob = (input: string): string => {
    const s = String(input).replace(/[\t\n\f\r ]/g, '').replace(/={1,2}$/, '');
    if (/[^A-Za-z0-9+/]/.test(s) || s.length % 4 === 1) throw new Error('atob: the string is not valid base64');
    let out = '';
    for (let i = 0; i < s.length; i += 4) {
      const n = (B64.indexOf(s[i]!) << 18) | (B64.indexOf(s[i + 1]!) << 12)
        | ((i + 2 < s.length ? B64.indexOf(s[i + 2]!) : 0) << 6) | (i + 3 < s.length ? B64.indexOf(s[i + 3]!) : 0);
      out += String.fromCharCode((n >> 16) & 255);
      if (i + 2 < s.length) out += String.fromCharCode((n >> 8) & 255);
      if (i + 3 < s.length) out += String.fromCharCode(n & 255);
    }
    return out;
  };
}

if (typeof g.structuredClone === 'undefined') {
  /** Plain data only: records, arrays, Date, Map and Set, with shared and cyclic references kept. */
  const clone = (value: unknown, seen: Map<unknown, unknown>): unknown => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'function') throw new Error('structuredClone: a function cannot be cloned');
      return value;
    }
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) {
      const copy = new Map();
      seen.set(value, copy);
      for (const [k, v] of value) copy.set(clone(k, seen), clone(v, seen));
      return copy;
    }
    if (value instanceof Set) {
      const copy = new Set();
      seen.set(value, copy);
      for (const v of value) copy.add(clone(v, seen));
      return copy;
    }
    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      seen.set(value, copy);
      for (const item of value) copy.push(clone(item, seen));
      return copy;
    }
    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    for (const key of Object.keys(value)) copy[key] = clone((value as Record<string, unknown>)[key], seen);
    return copy;
  };
  installed.push('structuredClone');
  g.structuredClone = (value: unknown) => clone(value, new Map());
}

if (typeof g.performance === 'undefined') {
  installed.push('performance');
  g.performance = { now: () => Date.now() };
}

if (typeof g.queueMicrotask === 'undefined') {
  installed.push('queueMicrotask');
  g.queueMicrotask = (callback: () => void) => { void Promise.resolve().then(callback); };
}

/** The globals this file installed in the running host. */
export const polyfills: readonly string[] = installed;
