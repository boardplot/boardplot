/**
 * Loop forms of `Math.max(...values)`, `Math.min(...values)` and
 * `target.push(...items)`. A spread passes every element as one call
 * argument, and the engine refuses a list of about 100,000 arguments with
 * `RangeError: Maximum call stack size exceeded`. Use these wherever the array
 * grows with the input rows, points, categories or cells; a spread stays fine
 * for a list of fixed size.
 *
 * The results equal the spread forms, NaN and signed zero included:
 * `maxOf([])` is -Infinity, one NaN makes the result NaN, and `maxOf([-0, 0])`
 * is +0 (`minOf` gives -0).
 */

export function maxOf(values: Iterable<number>): number {
  let max = -Infinity;
  for (const value of values) {
    if (value > max) max = value;
    else if (value !== value) return NaN;
    else if (value === 0 && max === 0 && Object.is(max, -0)) max = value;
  }
  return max;
}

export function minOf(values: Iterable<number>): number {
  let min = Infinity;
  for (const value of values) {
    if (value < min) min = value;
    else if (value !== value) return NaN;
    else if (value === 0 && min === 0 && Object.is(value, -0)) min = value;
  }
  return min;
}

/** `target.push(...items)` without the argument limit; returns the new length like push. */
export function pushAll<T>(target: T[], items: Iterable<T>): number {
  for (const item of items) target.push(item);
  return target.length;
}
