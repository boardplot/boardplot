import { canonicalJson, fnv64 } from './prepared';

/** The layout settings of a provider or of `prepareChart`'s context that a prepared chart depends on. */
export interface PreparedContext {
  theme?: unknown; target?: unknown; locale?: unknown; strings?: object; textScale?: unknown; textSize?: unknown; density?: unknown;
}

/**
 * What a prepared chart was laid out from, as its caller wrote it: the chart, the rows, the sizing props and the
 * provider settings. `prepareChart` stores the key of its input, and `BoardplotChart` compares it with the key of
 * its own props before it shows the prepared chart without the engine. Undefined for a value JSON cannot carry.
 */
export function preparedInputKey(chart: Record<string, unknown>, host: Record<string, unknown>, context: PreparedContext = {}): string | undefined {
  const { theme, target, locale, strings, textScale, textSize, density } = context;
  // A request with no options and one with empty options lay out the same.
  const { options, ...rest } = chart;
  if (options !== undefined && !(options && typeof options === 'object' && Object.keys(options).length === 0)) rest.options = options;
  try {
    return fnv64(canonicalJson({
      chart: rest, host,
      context: { theme, target, locale, textScale, textSize, density, strings: strings && Object.keys(strings).length ? strings : undefined },
    }));
  } catch { return undefined; }
}
