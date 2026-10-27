/**
 * An empty record keyed by data ids. It has no prototype, so `__proto__` is an
 * ordinary key and an id such as `constructor` that the record lacks reads as
 * undefined, not as the inherited function. Object.create(null) does the same,
 * but V8 keeps such an object in slow dictionary mode; this one stays as fast
 * as `{}`.
 */
export function emptyIdRecord<T>(): Record<string, T> {
  return Object.setPrototypeOf({}, null) as Record<string, T>;
}
