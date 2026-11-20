/**
 * The category a reader points at in a metric stack's focus look, on
 * `options.stack`. The React chart sets it while the pointer or the keyboard
 * rests on a category; the layout then draws that category as the compare
 * window. A registered symbol: the request keeps it and JSON never carries it.
 * It sits outside the chart folders, so shared React code links it without
 * linking a chart's core before the chart draws.
 */
export const STACK_FOCUS = Symbol.for('boardplot.metricStackFocus');

/** The options with the stack's focus on `category`, or unchanged where there is no category or no stack. */
export function withStackFocus<T extends object>(options: T, category: string | undefined): T {
  const stack = (options as { stack?: object }).stack;
  return category === undefined || stack === undefined ? options : { ...options, stack: { ...stack, [STACK_FOCUS]: category } };
}
