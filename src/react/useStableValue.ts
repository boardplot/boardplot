import { useRef } from 'react';

const immutable = new WeakSet<object>();

/** Internal generated data can skip snapshots only after every plain child is frozen. */
export function freezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || immutable.has(value) || (!Array.isArray(value) && !isPlain(value))) return value;
  for (const child of Object.values(value)) freezeValue(child);
  immutable.add(Object.freeze(value));
  return value;
}

function isPlain(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Plain objects and arrays compare by content; functions (a custom `measure`),
 * class instances and every other value by identity.
 */
function sameContent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameContent(item, right[index]));
  }
  if (Array.isArray(right) || !isPlain(left) || !isPlain(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    Object.hasOwn(right, key) && sameContent((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/**
 * The previous value while the new one has the same content. Props written
 * inline (`data={{ … }}`, `valueAxis={{ min: 0 }}`) are new objects on every
 * parent render; compared by reference, or one level deep, each render laid
 * the chart out again, and `onGeometry={setState}` then looped.
 */
export function useStableValue<T>(value: T): T {
  // Compare against a copy taken when the value last changed, not against the
  // previous object itself: a host that edits nested data in place and passes
  // a new top-level object would otherwise compare the edited object with
  // itself and keep the old layout.
  const stable = useRef<{ value: T }>(undefined);
  stable.current = { value: snapshot(value, stable.current?.value) as T };
  return stable.current.value;
}

/**
 * A copy of caller-owned plain objects and arrays. Object.freeze is shallow;
 * only internally deep-frozen data can safely stay by reference.
 */
function snapshot(value: unknown, previous?: unknown): unknown {
  // A size-only change must keep the unchanged data copy so dependent layouts can reuse it.
  if (sameContent(previous, value)) return previous;
  if (immutable.has(value as object)) return value;
  if (Array.isArray(value)) return value.map((item, index) => snapshot(item, Array.isArray(previous) ? previous[index] : undefined));
  // A primitive has a prototype that is not plain, so it returns here too.
  if (value == null || !isPlain(value)) return value;
  const prior = previous !== null && typeof previous === 'object' && isPlain(previous) ? previous as Record<string, unknown> : undefined;
  const copy: Record<string, unknown> = Object.assign(Object.create(Object.getPrototypeOf(value)), value);
  for (const key of Object.keys(value)) copy[key] = snapshot((value as Record<string, unknown>)[key], prior?.[key]);
  return copy;
}
