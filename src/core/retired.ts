/**
 * Every setting Boardplot once accepted and has since retired, in one place.
 * A retired setting is accepted for good, so a spec or theme saved long ago
 * still draws: a rename draws as its successor, a removal is ignored, and
 * both warn `option-deprecated` with a JSON Patch that rewrites or removes
 * it. Only a key that never existed is refused.
 */

import { addWhereAbsent, toJsonPointer } from './diagnostics/jsonPatch';
import { ANNOTATIONS_RETIRED, IGNORED_OPTION_KEYS, LEGEND_REFUSED, schemaRefusedKeys, valueAxisOnly, valueAxisRefusal } from './schema/capability';
import type { LintWarning } from './types/scene';

type Scalar = string | number | boolean;

/**
 * A retired chart setting. `at` is its dotted place in the chart, from
 * `options` or `data`; `[]` steps into every item of an array. `values`
 * retires only those values, each mapped to its successor value or to
 * `null` when the value is removed; without it every value is retired.
 * `to` is the successor key as a chart path; without `to` and `values` the
 * key is removed, and `use` says what to use instead.
 */
interface RetiredSetting {
  at: string;
  types?: readonly string[];
  values?: Readonly<Record<string, Scalar | null>>;
  to?: string;
  use?: string;
}

const removed = (types: readonly string[], at: readonly string[], use?: string): RetiredSetting[] =>
  at.map(path => ({ at: path, types, ...(use ? { use } : {}) }));

const RETIRED_SETTINGS: readonly RetiredSetting[] = [
  { at: 'options.strings.highlight', use: 'A highlight is never a key entry.' },
  { at: 'options.target', values: { legacy: null }, use: "Set target to 'report', 'dashboard', 'slide' or 'print'." },
  // Each chart form is named by one option, variant.
  { at: 'options.orient', types: ['waterfall'], to: 'options.variant' },
  { at: 'options.layout', types: ['funnel'], to: 'options.variant' },
  { at: 'options.variance.mode', types: ['variance'], to: 'options.variant' },
  { at: 'options.glyph', types: ['heatmap'], to: 'options.variant' },
  { at: 'options.mode', types: ['mekko'], to: 'options.variant', values: { percent: 'stacked100', unit: 'stacked', bar: 'bar' } },
  { at: 'options.preset', types: ['table'], to: 'options.variant', values: { plain: 'hierarchy', steering: 'steering', benchmark: 'benchmark', status: 'status', receipts: 'receipts', hierarchy: 'hierarchy' } },
  { at: 'options.exhibitStyle', types: ['cohort'], to: 'options.variant' },
  { at: 'options.preset', types: ['diagram'], to: 'options.variant' },
  { at: 'options.structure', types: ['dimswitch'], to: 'options.variant', values: { byMeasure: 'by-measure', byMember: 'by-member' } },
  { at: 'options.preset', types: ['dimswitch'], use: 'A dimswitch always draws the steering table.' },
  { at: 'options.order', types: ['dimswitch'], values: { authored: 'sheet' } },
  { at: 'options.order', types: ['treemap'], values: { data: 'sheet' } },
  { at: 'options.cascade', types: ['bartable'], to: 'options.variant', values: { true: 'cascade' } },
  { at: 'options.panelScale', types: ['bartable'], to: 'options.sharedScale', values: { own: false, shared: true } },
  { at: 'options.fillMode', types: ['waffle'], to: 'options.variant' },
  { at: 'options.shape', types: ['treemap'], to: 'options.variant' },
  { at: 'options.variant', types: ['line'], values: { stackedArea: 'stacked-area', area100: 'stacked100-area' } },
  { at: 'options.share', types: ['grid'], to: 'options.sharedAxis', values: { categories: 'category', none: 'none' } },
  // Unused options and data fields.
  ...removed(['line', 'combo'], ['options.endpointLabelDefault', 'options.lineLabels'], 'Set seriesLabels and valueLabels.'),
  ...removed(['pareto'], ['options.ruler']),
  ...removed(['grid'], ['options.gap', 'options.gutterWidth', 'options.showMaturing', 'options.totalPanel']),
  ...removed(['column', 'line', 'combo'], ['options.eventLegendFootnotes']),
  ...removed(['line', 'combo', 'grid'], ['options.hover'], 'Hover is the hover prop of the React component.'),
  { at: 'options.labels.growth', types: ['combo'], to: 'options.dualAxis.growth' },
  ...removed(['pvm'], ['options.effectOrder']),
  ...removed(['dot', 'butterfly', 'slope', 'variance', 'pie', 'heatmap', 'funnel'], ['data.categories.[].total100']),
  ...removed(['dot', 'butterfly', 'slope', 'variance', 'pie', 'heatmap', 'funnel', 'mekko'], ['data.categories.[].gapAfter', 'data.categories.[].breakAfter']),
  ...removed(['line', 'combo', 'slope', 'butterfly'], ['data.series.[].direction']),
  ...removed(['butterfly', 'heatmap'], ['data.series.[].role']),
  ...removed(['pie', 'heatmap'], ['data.series.[].fill']),
  ...removed(['diagram'], ['data.nodes.[].ports.[].priority']),
  // Options with no reader on these types.
  ...removed(['dimswitch'], ['options.groupRule', 'options.groupAlign'], 'These keys set the head of a column group, and a dimswitch draws none.'),
  ...removed(ANNOTATIONS_RETIRED, ['options.annotations', 'annotations'], 'This chart type draws no annotation of any kind.'),
  ...removed(['variance'], ['options.topN.showRestCount'], 'A variance chart draws no rest bucket, so it has no count to print.'),
  ...removed(['dot'], ['options.averageMarker.includePartial'], 'A dot chart averages every dot in scope.'),
  { at: 'options.strings.legendCount', use: 'No chart printed this wording.' },
  { at: 'data.pack', types: ['choropleth'], values: { 'de-laender': 'de-states' } },
  { at: 'options.density', types: ['dimswitch'], values: { cohort: null, 'cohort-small': null },
    use: "A cohort density is a one-line row and a dimswitch cell holds two lines; set 'compact' for tight rows." },
];

/** Theme keys without a successor, dotted from the theme root, with what to use instead. */
export const RETIRED_THEME_KEYS: Readonly<Record<string, string>> = {
  'space.barGap': "No chart read it: bar and column gaps come from each chart's layout and its bandFraction option.",
  'type.eyebrow.case': 'KPI eyebrows and waffle panel labels print names as written; to keep capitals, write them in the name. '
    + 'Where the theme widened type.eyebrow.tracking for capitals, set type.eyebrow.tracking back or remove it: absent means no letter-spacing, and a name in mixed case reads too wide with capital tracking.',
  'table.weights.change': 'Change lines take regular weight.',
  chrome: 'The notes popover shadow is the token surface.panelShadow.',
  'motion.update': 'Transitions take motion.easing, hoverIntent, fade, travel and layout.',
  'motion.exit': 'Transitions take motion.easing, hoverIntent, fade, travel and layout.',
};

/** Theme presets by an old name: the successor, and whether it draws the same. */
export const RETIRED_PRESETS: Readonly<Record<string, { to: string; same: boolean }>> = {
  ibcs: { to: 'notation', same: true },
  'ibcs-dark': { to: 'notation-dark', same: true },
  consulting: { to: 'boardroom', same: false },
  'legacy-glass': { to: 'boardroom', same: false },
};

/** Palette names without a successor: the theme's own series draw. */
export const RETIRED_PALETTES: ReadonlySet<string> = new Set(['garnet', 'heritage']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A shallow copy on the node's own prototype, with its symbol marks. */
function copyOf<T extends object>(node: T): T {
  const copy = Object.create(Object.getPrototypeOf(node)) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(node)) copy[key] = (node as Record<PropertyKey, unknown>)[key];
  return copy as T;
}

/** `root` with the value at `path` replaced, or removed for `undefined`; objects on the way are copied, missing ones created. */
function setAt(root: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const [key, ...rest] = path;
  const node = Array.isArray(root) ? [...root] : isRecord(root) ? copyOf(root) : {};
  const own = node as Record<PropertyKey, unknown>;
  const next = rest.length ? setAt(own[key!], rest, value) : value;
  if (next === undefined) delete own[key!];
  else own[key!] = next;
  return node;
}

function readAt(root: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((node, key) => (Array.isArray(node) || isRecord(node)) && Object.hasOwn(node, key) ? (node as Record<PropertyKey, unknown>)[key] : undefined, root);
}

/** Every place `steps` reaches in `node` that holds a value. */
function places(node: unknown, steps: readonly string[], at: (string | number)[] = []): (string | number)[][] {
  if (steps.length === 0) return node === undefined ? [] : [at];
  const [step, ...rest] = steps;
  if (step === '[]') return Array.isArray(node) ? node.flatMap((item, index) => places(item, rest, [...at, index])) : [];
  return isRecord(node) && Object.hasOwn(node, step!) ? places(node[step!], rest, [...at, step!]) : [];
}

const quoted = (value: unknown) => typeof value === 'string' ? `'${value}'` : String(value);

/** The content parts a `labels` array can name. */
const LABEL_PARTS: readonly unknown[] = ['absolute', 'percent', 'category', 'series'];

/** The warning for a valueLabels mode on a stacked variant, which has no single value per category. */
export function valueLabelsIgnoredWarning(type: 'bar' | 'column', variant: string): LintWarning {
  return {
    code: 'option-ignored', severity: 'warn', field: ['options', 'valueLabels'],
    message: `options.valueLabels picks single values and applies to grouped ${type === 'column' ? 'columns' : 'bars'} only; variant '${variant}' has no single value per category, so it is ignored.`,
    suggest: 'Remove options.valueLabels.',
    fix: [{ op: 'remove', path: '/options/valueLabels' }],
  };
}

/**
 * Settings that only some variants of a type draw, so `retired.ts` reads them
 * per variant. A spec without any of them reads no table below.
 */
const VARIANT_SCOPED_KEYS: ReadonlySet<string> = new Set([
  'averages', 'cohortSizeLabel', 'designatedPeriod', 'excludeCurrentPeriod', 'exhibitLabel', 'formatScope', 'heightFill', 'showPercentSign',
  'targetColumns', 'tornado',
]);

/** Cohort exhibit settings: the heatmap variant does not run the exhibit layout. */
const COHORT_EXHIBIT_ONLY = ['cohortSizeLabel', 'exhibitLabel', 'heightFill', 'showPercentSign', 'formatScope', 'excludeCurrentPeriod'] as const;

/** A chart copy without settings its type ignores, with one remove warning per setting. */
export function ignoreChartSettings<C extends { options?: unknown; data?: unknown }>(
  type: string, chart: C, canonical: (name: string) => string | undefined = (name) => name,
): { chart: C; warnings: LintWarning[] } {
  const warnings: LintWarning[] = [];
  let next: unknown = chart;
  const panels = type === 'grid' ? readAt(chart, ['data', 'panels']) : undefined;
  const nested: (string | number)[][] = [
    ...(Array.isArray(panels) ? panels.map((_, index) => ['data', 'panels', index]) : []),
    ...(type === 'grid' && isRecord(readAt(chart, ['data', 'template'])) ? [['data', 'template']] : []),
  ];
  for (const at of nested) {
    const panel = readAt(chart, at);
    const panelType = isRecord(panel) && typeof panel.type === 'string' ? canonical(panel.type) : undefined;
    if (panelType === undefined) continue;
    const ignored = ignoreChartSettings(panelType, panel as { options?: unknown; data?: unknown }, canonical);
    if (ignored.chart === panel) continue;
    next = setAt(next, at, ignored.chart);
    for (const warning of ignored.warnings) warnings.push({ ...warning, field: [...at, ...warning.field!],
      fix: warning.fix!.map(operation => ({ ...operation, path: toJsonPointer(at) + operation.path })) });
  }
  if (!isRecord(chart.options)) return { chart: next as C, warnings };
  const ignore = (field: string[], severity: 'warn' | 'info' = 'warn', on: string = type) => {
    next = setAt(next, field, undefined);
    const dotted = field.join('.');
    warnings.push({ code: 'option-ignored', severity, field,
      message: `${dotted} has no effect on ${on} and is ignored.`,
      suggest: `Remove ${dotted}.`, fix: [{ op: 'remove', path: toJsonPointer(field) }] });
  };
  // Most requests carry none of these settings: leave before any table is read.
  const authored = Object.keys(chart.options);
  if (!authored.some((key) => IGNORED_OPTION_KEYS.has(key) || VARIANT_SCOPED_KEYS.has(key) || key === 'valueAxis' || key === 'legend' || key === 'valueLabels')) return { chart: next as C, warnings };
  if (authored.some((key) => IGNORED_OPTION_KEYS.has(key))) {
    for (const key of schemaRefusedKeys(type).options) {
      if (IGNORED_OPTION_KEYS.has(key) && chart.options[key] !== undefined) ignore(['options', key]);
    }
  }
  const axis = chart.options.valueAxis;
  if (isRecord(axis)) {
    let dropped = false;
    for (const key of ['show', 'gridlines']) {
      if (axis[key] === undefined || valueAxisRefusal(type, key) === undefined) continue;
      ignore(['options', 'valueAxis', key], axis[key] === false ? 'info' : 'warn');
      dropped = true;
    }
    if ((dropped || valueAxisOnly(type)?.keys.length === 0) && Object.keys(readAt(next, ['options', 'valueAxis']) as object).length === 0) {
      next = setAt(next, ['options', 'valueAxis'], undefined);
    }
  }
  const legend = chart.options.legend;
  if (legend !== undefined && (LEGEND_REFUSED.includes(type) || (type === 'slope' && (legend === 'none' || legend === 'auto')))) {
    ignore(['options', 'legend'], legend === 'none' || legend === 'auto' ? 'info' : 'warn');
  }
  // Remove an ignored label mode before the chart's SVG ids are computed too.
  if (type === 'bar' || type === 'column') {
    const options = readAt(next, ['options']) as Record<string, unknown>;
    const variant = type === 'column' && isRecord(options.valueAxis) && options.valueAxis.percent ? 'stacked100' : options.variant;
    if (options.valueLabels !== undefined && options.valueLabels !== 'all' && typeof variant === 'string' && variant !== 'grouped') {
      next = setAt(next, ['options', 'valueLabels'], undefined);
      warnings.push(valueLabelsIgnoredWarning(type, variant));
    }
  }
  ignoreVariantSettings(type, readAt(chart, ['type']), readAt(next, ['options']) as Record<string, unknown>, ignore);
  return { chart: next as C, warnings };
}

/**
 * Drops what the chosen variant has no part for. The request fills a default
 * variant only after this runs, and an alias such as dumbbell sets its variant
 * later too, so both are read here: an omitted cohort variant is heatmap, an
 * omitted bar variant is grouped.
 */
const VARIANT_NAMES: Readonly<Record<string, readonly string[]>> = {
  cohort: ['heatmap', 'pure', 'stepped'],
  bar: ['grouped', 'stacked', 'stacked100', 'football-field', 'tornado'],
  dot: ['dot', 'dumbbell', 'lollipop'],
};

function ignoreVariantSettings(type: string, name: unknown, options: Record<string, unknown>, ignore: (field: string[], severity: 'warn' | 'info', on: string) => void): void {
  // The schema path accepts a variant in any case and runs this again after conversion, so it warns there. React reads the raw text and draws another layout.
  if (typeof options.variant === 'string' && VARIANT_NAMES[type] && !VARIANT_NAMES[type].includes(options.variant)) return;
  const drop = (field: string[], variant: string) => ignore(field, 'warn', `${type} variant '${variant}'`);
  const set = (key: string) => options[key] !== undefined;
  const restCount = () => { if (isRecord(options.topN) && options.topN.showRestCount !== undefined) drop(['options', 'topN', 'showRestCount'], String(options.variant ?? name)); };
  if (type === 'cohort') {
    const variant = typeof options.variant === 'string' ? options.variant : 'heatmap';
    if (variant === 'heatmap') for (const key of COHORT_EXHIBIT_ONLY) if (set(key)) drop(['options', key], variant);
    // false stays with its own refusal, which names the one variant that takes it.
    if (variant !== 'pure' && typeof options.designatedPeriod === 'number') drop(['options', 'designatedPeriod'], variant);
    if (variant !== 'heatmap' && set('averages')) drop(['options', 'averages'], variant);
    if (variant === 'pure' && set('legend')) drop(['options', 'legend'], variant);
  } else if (type === 'bar') {
    const variant = typeof options.variant === 'string' ? options.variant : 'grouped';
    if (variant !== 'tornado' && set('tornado')) drop(['options', 'tornado'], variant);
    if (variant === 'tornado' || variant === 'football-field') restCount();
  } else if (type === 'dot') {
    if (options.variant === 'dumbbell' || options.variant === 'lollipop' || (options.variant === undefined && (name === 'dumbbell' || name === 'lollipop'))) restCount();
  } else if (type === 'bullet' && options.sharedScale === 'percentOfTarget' && set('targetColumns')) {
    ignore(['options', 'targetColumns'], 'warn', "bullet with sharedScale 'percentOfTarget'");
  }
}

/**
 * The chart's options and data with every retired setting rewritten to its
 * successor or removed, and one `option-deprecated` warning for each.
 * Unused settings are removed with `option-ignored`. The input is never
 * changed: an edited object is a copy. `type` is canonical.
 */
export function retireChartSettings<C extends { options?: unknown; data?: unknown }>(
  type: string, chart: C, canonical: (name: string) => string | undefined = (name) => name,
): { chart: C; warnings: LintWarning[] } {
  const warnings: LintWarning[] = [];
  let next: unknown = chart;
  // A grid's explicit panels and its repeat template are charts of their own type.
  const panels = type === 'grid' ? readAt(chart, ['data', 'panels']) : undefined;
  const nested: (string | number)[][] = [
    ...(Array.isArray(panels) ? panels.map((_, index) => ['data', 'panels', index]) : []),
    ...(type === 'grid' && isRecord(readAt(chart, ['data', 'template'])) ? [['data', 'template']] : []),
  ];
  for (const at of nested) {
    const panel = readAt(chart, at);
    const panelType = isRecord(panel) && typeof panel.type === 'string' ? canonical(panel.type) : undefined;
    if (panelType === undefined) continue;
    const retired = retireChartSettings(panelType, panel as { options?: unknown; data?: unknown }, canonical);
    if (retired.chart === panel) continue;
    next = setAt(next, at, retired.chart);
    for (const warning of retired.warnings) {
      warnings.push({ ...warning, field: [...at, ...warning.field!],
        fix: warning.fix!.map(operation => ({ ...operation, path: toJsonPointer(at) + operation.path })) });
    }
  }
  for (const entry of RETIRED_SETTINGS) {
    if (entry.types && !entry.types.includes(type)) continue;
    for (const at of places(next, entry.at.split('.'))) {
      const value = readAt(next, at);
      const scalar = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
      if (entry.values && !(scalar && Object.hasOwn(entry.values, String(value)))) continue;
      const successor = entry.values ? entry.values[String(value)] : value;
      const target = entry.to?.split('.') ?? at;
      const dotted = at.join('.');
      const what = entry.values ? `${dotted} ${quoted(value)}` : dotted;
      const path = toJsonPointer(at);
      // A successor the author already set wins over the retired setting.
      const taken = entry.to !== undefined && readAt(next, target) !== undefined;
      if (successor === null || (!entry.values && !entry.to) || taken) {
        next = setAt(next, at, undefined);
        warnings.push({ code: 'option-deprecated', severity: 'warn', field: at,
          message: `${what} is retired and ignored.`,
          suggest: [`Remove ${dotted}.`, ...(taken ? [`${entry.to} is set and wins.`] : entry.use ? [entry.use] : [])].join(' '),
          fix: [{ op: 'remove', path }] });
      } else if (entry.to === undefined) {
        next = setAt(next, at, successor);
        warnings.push({ code: 'option-deprecated', severity: 'warn', field: at,
          message: `${what} is renamed ${quoted(successor)}.`,
          suggest: `Set ${dotted} to ${quoted(successor)}.`,
          fix: [{ op: 'test', path, value }, { op: 'replace', path, value: successor }] });
      } else {
        const without = setAt(next, at, undefined);
        next = setAt(without, target, successor);
        const now = `${entry.to}${entry.values ? ` ${quoted(successor)}` : ''}`;
        warnings.push({ code: 'option-deprecated', severity: 'warn', field: at,
          message: `${what} is renamed ${now}.`,
          suggest: `Replace ${dotted} with ${entry.to}: ${JSON.stringify(successor)}.`,
          // The add lands at the deepest parent the spec has, carrying the missing objects.
          fix: [{ op: 'remove', path }, ...addWhereAbsent(without, [{ op: 'replace', path: toJsonPointer(target), value: successor }])] });
      }
    }
  }
  // Schema takes any string as a part, and a part no chart reads drew an empty label. `value` means
  // the number; with no part left the kind draws its default content.
  const labels = readAt(next, ['options', 'labels']);
  for (const [kind, content] of Object.entries(isRecord(labels) ? labels : {})) {
    if (!Array.isArray(content) || content.every(part => LABEL_PARTS.includes(part))) continue;
    const at = ['options', 'labels', kind];
    const dotted = at.join('.');
    const unread = content.filter(part => !LABEL_PARTS.includes(part));
    const kept = [...new Set(content.map(part => part === 'value' ? 'absolute' : part).filter(part => LABEL_PARTS.includes(part)))];
    next = setAt(next, at, kept.length > 0 ? kept : undefined);
    const path = toJsonPointer(at);
    warnings.push({ code: 'option-deprecated', severity: 'warn', field: at,
      message: `${dotted} has ${unread.map(quoted).join(', ')}, which is not a label part. The parts are absolute, percent, category and series.`,
      suggest: kept.length > 0 ? `Set ${dotted} to ${JSON.stringify(kept)}.` : `Remove ${dotted} for the default label, or set one of the parts.`,
      fix: kept.length > 0 ? [{ op: 'test', path, value: content }, { op: 'replace', path, value: kept }] : [{ op: 'remove', path }] });
  }
  const ignored = ignoreChartSettings(type, next as C, canonical);
  return { chart: ignored.chart, warnings: [...warnings, ...ignored.warnings] };
}

/**
 * The theme without its retired keys, and the dotted path of each key it
 * dropped. The input is never changed.
 */
export function withoutRetiredThemeKeys<T>(theme: T): { theme: T; found: string[] } {
  const found = Object.keys(RETIRED_THEME_KEYS).filter(dotted => places(theme, dotted.split('.')).length > 0);
  return { theme: found.reduce<unknown>((next, dotted) => setAt(next, dotted.split('.'), undefined), theme) as T, found };
}

/** The warning for a retired theme key found under `root` (segments of the field). */
export function retiredThemeKeyWarning(dotted: string, root: readonly (string | number)[]): LintWarning {
  const field = [...root, ...dotted.split('.')];
  return {
    code: 'option-deprecated', severity: 'warn', field,
    message: `Theme key ${dotted} is retired and ignored.`,
    suggest: `Remove ${dotted}. ${RETIRED_THEME_KEYS[dotted]}`,
    fix: [{ op: 'remove', path: toJsonPointer(field) }],
  };
}
