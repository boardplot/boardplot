import { drawnVariant } from './stackAdds';

/**
 * The series a reader hides with a legend click, on the options of a mounted React chart. A registered symbol:
 * the request keeps it and JSON never carries it, so the CLI, the MCP tools and the server draw every series.
 * A list, not a set, so the layout's request key tells two hidden lists apart.
 */
export const HIDDEN_SERIES = Symbol.for('boardplot.hiddenSeries');

/** The options with `ids` hidden, or unchanged when nothing is hidden. */
export function withHiddenSeries<T extends object>(options: T, ids: readonly string[]): T {
  return ids.length ? { ...options, [HIDDEN_SERIES]: ids } : options;
}

/** The series of `all` the reader has not hidden: `all` itself when none is hidden or every one is. */
export function shownSeries<S extends { id: string }>(options: object, all: S[]): S[] {
  const hidden = (options as { [HIDDEN_SERIES]?: readonly string[] })[HIDDEN_SERIES];
  const shown = hidden ? all.filter((s) => !hidden.includes(s.id)) : all;
  return shown.length && shown.length < all.length ? shown : all;
}

/**
 * Whether the layout draws without the hidden series: grouped, stacked and 100% stacked columns and bars.
 * A tornado and a football field lay their rows out of the series cases, so they offer no legend click.
 */
export function readsHiddenSeries(type: string, options: { variant?: string; valueAxis?: { percent?: boolean } }): boolean {
  return (type === 'column' || type === 'bar') && ['grouped', 'stacked', 'stacked100'].includes(drawnVariant(type, options) ?? 'grouped');
}
