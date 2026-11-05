import { copyFrame, footerPlans } from './footer';
import { currentSmallValues } from './formatPrecision';
import { emptyIdRecord } from './idRecords';
import type { FrameGeometry } from './types/scene';

const functionIds = new WeakMap<object, number>();
let nextFunctionId = 0;

/**
 * The cache key of a layout: the data, the options and their symbol keys.
 * A function (the text measurer) enters by identity. The data is part of the
 * key, so data changed in place never reads an older result.
 */
export function layoutKey(data: object, options: object): string {
  const symbols = Object.getOwnPropertySymbols(options).map((symbol) => [symbol.description, (options as Record<symbol, unknown>)[symbol]]);
  // The smallValues mode in force too: a nested table inherits its enclosing chart's mode.
  return JSON.stringify([data, options, symbols, currentSmallValues()], (_key, value: unknown) => {
    if (typeof value !== 'function') return value;
    if (!functionIds.has(value)) functionIds.set(value, nextFunctionId++);
    return `function ${functionIds.get(value)}`;
  });
}

/** Copy shared fonts and cells once per result. A copy of every array, Map, Set and plain object; a function and any other value is shared (the compiled options hold the measurer). */
export function deepCopy<T>(value: T, copies = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const known = copies.get(value);
  if (known !== undefined) return known as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const entry of value) copy.push(deepCopy(entry, copies));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    copies.set(value, copy);
    for (const [key, entry] of value) copy.set(key, deepCopy(entry, copies));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const entry of value) copy.add(deepCopy(entry, copies));
    return copy as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  // A null-prototype record (cells keyed by column id) stays one, so a column named __proto__ keeps its cell.
  const copy: Record<PropertyKey, unknown> = footerPlans.has(value as FrameGeometry)
    ? copyFrame(value as FrameGeometry) as Record<PropertyKey, unknown> : Object.getPrototypeOf(value) === null ? emptyIdRecord() : {};
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const entry = deepCopy((value as Record<PropertyKey, unknown>)[key], copies);
    // Note metadata stays outside a note's public fields, also on the copy a caller receives.
    if (typeof key === 'symbol' && !Object.prototype.propertyIsEnumerable.call(value, key)) Object.defineProperty(copy, key, { value: entry, configurable: true });
    else copy[key] = entry;
  }
  return copy as T;
}

const requestTables = new WeakSet<object>();
const requestResults = new WeakMap<object, Map<string, unknown>>();

/** Whether a table request is running on this data, so its passes' layouts never reach a caller. */
export const tableRequestOwns = (data: object): boolean => requestTables.has(data);

/**
 * One public table layout. Its fit passes share objects freely, and the result it returns is a
 * copy, so a caller's edits never reach a later result. A host that lays out again on stable data
 * reads the stored result: the key holds the data, so data changed in place lays out again.
 * The ownership ends with the request, also when a layout throws.
 * shortcut: 32 results per data object, then the map starts again.
 */
export function ownTableRequest<T>(data: object, key: string, layout: () => T): T {
  let byKey = requestResults.get(data);
  if (!byKey || byKey.size >= 32) requestResults.set(data, byKey = new Map());
  if (!byKey.has(key)) {
    const outer = requestTables.has(data);
    requestTables.add(data);
    try { byKey.set(key, layout()); }
    finally { if (!outer) requestTables.delete(data); }
  }
  return deepCopy(byKey.get(key)) as T;
}
