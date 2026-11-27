import { canonicalJson, fnv64 } from './prepared';

/** The layout settings of a provider or of `prepareChart`'s context that a prepared chart depends on. */
export interface PreparedContext {
  theme?: unknown; target?: unknown; locale?: unknown; strings?: object; textScale?: unknown; textSize?: unknown; density?: unknown;
}

/**
 * One chart in the form both sides compare: a spec (a bare chart or a document of one chart) or the request that
 * `prepareChart` received. The name drops. The theme the chart's options do not set comes from the document root, a
 * bare chart's or a request's top level, or the host's `theme` prop, in that order, as the layout reads it. A language
 * tag stands for `{ language }`, and a key whose value is undefined counts as absent, as it does once JSON carries the
 * spec. Undefined for a document of several charts.
 */
function comparableChart(input: unknown, host: { theme?: unknown; target?: unknown }): unknown {
  if (!input || typeof input !== 'object') return undefined;
  const root = input as { charts?: unknown; theme?: unknown; locale?: unknown };
  const document = Array.isArray(root.charts);
  if (document && (root.charts as unknown[]).length !== 1) return undefined;
  const chart = (document ? (root.charts as unknown[])[0] : root) as Record<string, unknown> | undefined;
  if (!chart || typeof chart !== 'object') return undefined;
  const { name: _name, theme, options, ...rest } = chart;
  const own = (options && typeof options === 'object' ? options : {}) as { theme?: unknown; locale?: unknown };
  const locale = own.locale ?? (document ? root.locale : undefined);
  return {
    target: host.target, ...rest,
    options: { ...own, theme: own.theme ?? (document ? root.theme : theme) ?? host.theme, locale: typeof locale === 'string' ? { language: locale } : locale },
  };
}

/**
 * What a prepared chart was laid out from: the chart, the rows, the sizing props and the provider settings.
 * `prepareChart` stores the key of its request, and `BoardplotChart` compares it with the key of its spec and props
 * before it shows the prepared chart without the engine. Undefined for a value JSON cannot carry.
 */
export function preparedInputKey(input: unknown, sizing: Record<string, unknown>, context: PreparedContext = {}, host: { theme?: unknown; target?: unknown } = {}): string | undefined {
  const chart = comparableChart(input, host);
  if (chart === undefined) return undefined;
  const { theme, target, locale, strings, textScale, textSize, density } = context;
  try {
    // JSON drops a key whose value is undefined, so it and a missing key give one key.
    return fnv64(canonicalJson({
      chart, host: sizing,
      context: { theme, target, locale, textScale, textSize, density, strings: strings && Object.keys(strings).length ? strings : undefined },
    }));
  } catch { return undefined; }
}
