import type { Paint, SceneNode } from '../core/types/scene';
import type { PreparedChart } from './prepared';
import { canonicalJson, fnv64 } from './canonicalJson';

/** The layout settings of a provider or of `prepareChart`'s context that a prepared chart depends on. */
export interface PreparedContext {
  theme?: unknown; target?: unknown; locale?: unknown; strings?: object; textScale?: unknown; textSize?: unknown; density?: unknown;
}

type Fields = Record<string, unknown>;

/**
 * One page in a form that every page drawing the same chart shares: a bare chart and a document of one chart read
 * alike, the root theme and language tag stand under the chart's options, a language tag stands for `{ language }`, and
 * a theme or target that the host's prop overrides drops. Only a value that validation accepts moves or drops, so a
 * page that the live chart refuses keeps a form of its own. The form only groups pages: `prepareChart` keys a page only
 * after the parser and the layout turned it into the prepared chart.
 */
function pageForm(spec: unknown, host: Fields, themes: object): unknown {
  const named = (theme: unknown) => typeof theme === 'string' && theme in themes;
  const page = Object(spec) as Fields;
  const document = Array.isArray(page.charts);
  const { version, charts, theme, ...top } = page;
  const { locale, $schema, ...root } = document ? top : {};
  // A document may carry a schema hint, a bare chart may not.
  if (typeof $schema !== 'string') root.$schema = $schema;
  const { name, options = {}, type, data, annotations, ...extra } = Object(document ? (charts as unknown[])[0] : top) as Fields & { options?: Fields };
  // rows and columns map only a bare chart. Options of null throw here, and the page gets no key.
  if ((document ? (charts as unknown[]).length !== 1 || version !== 1 || (host.rows ?? host.columns) !== undefined
    : charts !== undefined || version !== undefined) || options.constructor !== Object
    // A field that only one of the two shapes takes, such as a document chart's repeat or a bare chart's title.
    || Object.values(extra).some(value => value !== undefined)) return spec;
  const own: Fields = { ...options };
  if (!named(theme)) root.theme = theme;
  else if (own.theme === undefined) own.theme = theme;
  if (own.locale === undefined && typeof locale === 'string') own.locale = locale;
  else root.locale = locale;
  if (typeof own.locale === 'string') own.locale = { language: own.locale };
  if (host.theme !== undefined && named(own.theme)) own.theme = undefined;
  if (host.target !== undefined && ['report', 'dashboard', 'slide', 'print'].includes(own.target as string)) own.target = undefined;
  // A name that is a file stem is valid in both shapes. A bare chart may leave it out, a document's chart may not.
  return { root, chart: { type, data, annotations, options: own,
    name: typeof name === 'string' && /^[\w-][\w.-]{0,99}$/.test(name) || !document && name === undefined ? undefined : [document, name] } };
}

/**
 * The key of a page as `BoardplotChart` gets it: the page form of its spec (see `pageForm`), the host's theme, target
 * and sizing props and the provider settings. `prepareChart` stores the keys of the pages that the parser and the
 * layout turn into its chart, and the first frame shows the chart only for one of them. Undefined for a value JSON
 * cannot carry. `themes` is the theme registry of `src/core/theme.ts`: only a registered theme name drops or moves.
 * The chart's data enters as its own hash, so `prepareChart` hashes the data of its pages once (`hashData`).
 */
export function preparedInputKey(spec: unknown, host: Fields, context: PreparedContext = {}, themes: object, hashData = dataHash): string | undefined {
  const { theme, target, locale, strings, textScale, textSize, density } = context;
  try {
    // The JSON copy holds the chart's data apart as a mark; its hash enters next to the page, where no spec can write it.
    // Data that JSON reads through toJSON or a getter is hashed from the copy, so every page hashes what JSON reads.
    const page = Object(spec) as Fields, chart = Object(Array.isArray(page.charts) ? page.charts[0] : page) as Fields, data = chart.data;
    let hash: string | undefined;
    const copy = JSON.parse(JSON.stringify(spec, function (this: unknown, key, value: unknown) {
      return this === chart && key === 'data' && value === data && typeof data === 'object' && data !== null ? (hash = hashData(data), 0) : value;
    }));
    const held = Object(Array.isArray(copy?.charts) ? copy.charts[0] : copy) as Fields;
    if (hash === undefined && held.data !== null && typeof held.data === 'object') { hash = dataHash(held.data); held.data = 0; }
    return fnv64(canonicalJson({ page: pageForm(copy, host, themes), data: hash,
      host, theme, target, locale, textScale, textSize, density, strings: strings && Object.keys(strings).length ? strings : undefined }));
  } catch { return undefined; }
}

/** The hash of a chart's data as JSON carries it. */
export const dataHash = (data: unknown): string => fnv64(canonicalJson(JSON.parse(JSON.stringify(data))));

/** A line chart with a zoom aggregate is prepared for that zoom: its page key carries the range, grains and aggregate of the zoom. */
export const zoomPageKey = (page: string, zoom: unknown): string => {
  const z = zoom as { aggregate?: unknown; grains?: unknown; range?: unknown } | undefined;
  return z && typeof z === 'object' && z.aggregate ? `${page}:zoom:${fnv64(canonicalJson({ aggregate: z.aggregate, grains: z.grains, range: z.range }))}` : page;
};

type MatrixInk = { token: string; theme: { kind: 'contrast-ink'; matrix?: Paint[] | number } };
export const matrixInk = (node: SceneNode): MatrixInk | undefined => node.t === 'text' && 'token' in node.ink && node.ink.theme?.kind === 'contrast-ink' && node.ink.theme.matrix !== undefined
  ? node.ink as unknown as MatrixInk : undefined;

/** The result of a prepared chart with each label's matrix list put back, shared again so one decision serves the whole matrix. */
export function preparedResult(prepared: PreparedChart): PreparedChart['result'] {
  const { result, matrices } = prepared;
  if (!matrices || result.refused) return result;
  return { ...result, scene: result.scene.map((node) => {
    const ink = matrixInk(node);
    return ink ? { ...node, ink: { ...ink, theme: { ...ink.theme, matrix: matrices[ink.theme.matrix as number] } } } as SceneNode : node;
  }) };
}

