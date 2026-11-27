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
 */
export function preparedInputKey(spec: unknown, host: Fields, context: PreparedContext = {}, themes: object): string | undefined {
  const { theme, target, locale, strings, textScale, textSize, density } = context;
  try {
    // JSON drops a key whose value is undefined, so it and a missing key give one key, as they give one live chart.
    return fnv64(canonicalJson({ page: pageForm(JSON.parse(JSON.stringify(spec)), host, themes), host, theme, target, locale, textScale, textSize, density,
      strings: strings && Object.keys(strings).length ? strings : undefined }));
  } catch { return undefined; }
}

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

