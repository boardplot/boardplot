/** The CLI uses this only to compare resolved themes: plain records, arrays and scalar values. */
export function isDeepStrictEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const prototype = Object.getPrototypeOf(a);
  if (prototype !== Object.getPrototypeOf(b)) return false;
  // An unsupported value takes the normal validation path instead of skipping it.
  if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) return false;
  if (Array.isArray(a) && a.length !== b.length) return false;
  const keys = object => Reflect.ownKeys(object).filter(key => Object.prototype.propertyIsEnumerable.call(object, key));
  const own = keys(a);
  return own.length === keys(b).length && own.every(key => Object.hasOwn(b, key) && isDeepStrictEqual(a[key], b[key]));
}
