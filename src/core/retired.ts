/**
 * Every setting Boardplot once accepted and has since retired. A setting of one
 * chart type alone sits in that type's folder (`charts/<type>/retired.ts`), so
 * a chart entry links only its own; the rest are here.
 * A retired setting is accepted for good, so a spec or theme saved long ago
 * still draws: a rename draws as its successor, a removal is ignored, and
 * both warn `option-deprecated` with a JSON Patch that rewrites or removes
 * it. Only a key that never existed is refused.
 */

import { addWhereAbsent, toJsonPointer } from './diagnostics/jsonPatch';
import { ANNOTATIONS_RETIRED, CATEGORY_AXIS_SUPPORT, IGNORED_ON, IGNORED_OPTION_KEYS, LEGEND_REFUSED, schemaRefusedKeys, valueAxisOnly, valueAxisRefusal } from './schema/capability';
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
export interface RetiredSetting {
  at: string;
  types?: readonly string[];
  values?: Readonly<Record<string, Scalar | null>>;
  to?: string;
  use?: string;
}

/** type -> the retired settings of that type alone, kept in its folder and linked by its core and its schemas. */
const OWN_SETTINGS = new Map<string, readonly RetiredSetting[]>();

/** Called by the registry when a chart's core or schemas register: the type's own retired settings join the shared ones. */
export function linkRetiredSettings(type: string, settings: readonly RetiredSetting[] | undefined): void {
  if (settings) OWN_SETTINGS.set(type, settings);
}

/** A shared row may list several places that share the rest of the row. */
type SharedRetiredSetting = Omit<RetiredSetting, 'at'> & { at: string | readonly string[] };

const RETIRED_SETTINGS: readonly SharedRetiredSetting[] = [
  { at: 'options.animate', use: 'The SVG is static. Set options.interactive to add hover and focus semantics.' },
  { at: 'options.debug', use: 'Boardplot has no debug output.' },
  { at: 'options.secondaryAxis.acknowledge', use: "A combo line or area with axis: 'secondary' draws a second value scale and warns dual-axis." },
  { at: 'options.strings.highlight', use: 'A highlight is never a key entry.' },
  { at: 'options.target', values: { legacy: null }, use: "Set target to 'report', 'dashboard', 'slide' or 'print'." },
  // Unused options and data fields.
  { at: ['options.endpointLabelDefault', 'options.lineLabels'], types: ['line', 'combo'], use: 'Set seriesLabels and valueLabels.' },
  { at: 'options.eventLegendFootnotes', types: ['column', 'line', 'combo'] },
  { at: 'options.hover', types: ['line', 'combo', 'grid'], use: 'Hover is the hover prop of the React component.' },
  { at: 'options.labels.growth', types: ['combo'], to: 'options.dualAxis.growth' },
  { at: 'data.categories.[].total100', types: ['dot', 'butterfly', 'slope', 'variance', 'pie', 'heatmap', 'funnel'] },
  { at: ['data.categories.[].gapAfter', 'data.categories.[].breakAfter'], types: ['dot', 'butterfly', 'slope', 'variance', 'pie', 'heatmap', 'funnel', 'mekko'] },
  { at: 'data.series.[].direction', types: ['line', 'combo', 'slope', 'butterfly'] },
  { at: 'data.series.[].role', types: ['butterfly', 'heatmap'] },
  { at: 'data.series.[].fill', types: ['pie', 'heatmap'] },
  // Options with no reader on these types.
  { at: ['options.annotations', 'annotations'], types: ANNOTATIONS_RETIRED, use: 'This chart type draws no annotation of any kind.' },
  { at: 'options.strings.legendCount', use: 'No chart printed this wording.' },
  // Options whose only effect on these types was a warning that they do nothing.
  { at: 'options.categoryAxis.crossesBetween', types: ['column', 'combo'], use: 'Columns always sit in the middle of their bands.' },
  { at: 'options.fitFormats', types: ['table', 'dimswitch'], use: 'A figure prints the same text at every width, and its track widens to hold it. To print fewer digits, set a shorter format example.' },
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

/**
 * A shallow copy on the node's own prototype, with its symbol marks. Every key
 * is defined fresh and writable, so a frozen source does not freeze the copy,
 * and defining (not assigning) keeps an own `__proto__` key off the prototype setter.
 */
function copyOf<T extends object>(node: T): T {
  const copy = Object.create(Object.getPrototypeOf(node)) as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(node)) {
    Object.defineProperty(copy, key, {
      value: (node as Record<PropertyKey, unknown>)[key], writable: true, configurable: true,
      enumerable: Object.prototype.propertyIsEnumerable.call(node, key),
    });
  }
  return copy as T;
}

/** `root` with the value at `path` replaced, or removed for `undefined`; objects on the way are copied, missing ones created. */
function setAt(root: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const [key, ...rest] = path;
  const node = Array.isArray(root) ? [...root] : isRecord(root) ? copyOf(root) : {};
  const own = node as Record<PropertyKey, unknown>;
  const current = Object.hasOwn(own, key!) ? own[key!] : undefined;
  const next = rest.length ? setAt(current, rest, value) : value;
  if (next === undefined) delete own[key!];
  else if (Array.isArray(node)) own[key!] = next;
  else Object.defineProperty(own, key!, { value: next, writable: true, enumerable: true, configurable: true });
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
  'annotations', 'arrow', 'averageMarker', 'averages', 'baseValue', 'cap', 'cascade', 'cohortSizeLabel', 'connectors', 'currentValue', 'designatedPeriod', 'diverging',
  'excludeCurrentPeriod', 'exhibitLabel', 'formatScope', 'gapColumn', 'grandTotalLabels', 'heightFill', 'netLine', 'rebase100', 'rounding', 'showPercentSign',
  'stageShade', 'targetColumns', 'tornado', 'totalCvr', 'worstDropCallout',
]);

/** Cohort exhibit settings: the heatmap variant does not run the exhibit layout. */
const COHORT_EXHIBIT_ONLY = ['cohortSizeLabel', 'exhibitLabel', 'heightFill', 'showPercentSign', 'formatScope', 'excludeCurrentPeriod'] as const;

type Settle = (type: string, chart: { options?: unknown; data?: unknown }) => { chart: unknown; warnings: LintWarning[] };

/** A grid's explicit panels and its repeat template are charts of their own type: the chart with each settled, and their warnings pointed into it. */
function settlePanels(type: string, chart: unknown, settle: Settle, canonical: (name: string) => string | undefined): { next: unknown; warnings: LintWarning[] } {
  const warnings: LintWarning[] = [];
  let next = chart;
  const panels = type === 'grid' ? readAt(chart, ['data', 'panels']) : undefined;
  const nested: (string | number)[][] = [
    ...(Array.isArray(panels) ? panels.map((_, index) => ['data', 'panels', index]) : []),
    ...(type === 'grid' && isRecord(readAt(chart, ['data', 'template'])) ? [['data', 'template']] : []),
  ];
  for (const at of nested) {
    const panel = readAt(chart, at);
    const panelType = isRecord(panel) && typeof panel.type === 'string' ? canonical(panel.type) : undefined;
    if (panelType === undefined) continue;
    const settled = settle(panelType, panel as { options?: unknown; data?: unknown });
    if (settled.chart !== panel) next = setAt(next, at, settled.chart);
    for (const warning of settled.warnings) {
      warnings.push({ ...warning, field: [...at, ...warning.field!],
        ...(warning.fix && { fix: warning.fix.map(operation => ({ ...operation, path: toJsonPointer(at) + operation.path })) }) });
    }
  }
  return { next, warnings };
}

/** A chart copy without settings its type ignores, with one remove warning per setting. */
export function ignoreChartSettings<C extends { options?: unknown; data?: unknown }>(
  type: string, chart: C, canonical: (name: string) => string | undefined = (name) => name,
): { chart: C; warnings: LintWarning[] } {
  let { next, warnings } = settlePanels(type, chart, (panelType, panel) => ignoreChartSettings(panelType, panel, canonical), canonical);
  if (!isRecord(chart.options)) return { chart: next as C, warnings };
  // These keys were left out of SVG ids before they became retired settings.
  for (const key of ['animate', 'debug']) {
    if (readAt(chart, ['options', key]) !== undefined) next = setAt(next, ['options', key], undefined);
  }
  // An empty secondaryAxis config draws like an omitted one, including after its retired flag is removed.
  if (Object.hasOwn(chart.options, 'secondaryAxis') && isRecord(chart.options.secondaryAxis)) {
    const path = ['options', 'secondaryAxis'];
    const axis = chart.options.secondaryAxis;
    if (Reflect.ownKeys(axis).every(key => key === 'acknowledge')) next = setAt(next, path, undefined);
    else if (Object.hasOwn(axis, 'acknowledge')) next = setAt(next, [...path, 'acknowledge'], undefined);
  }
  const ignore = (field: string[], severity: 'warn' | 'info' = 'warn', on: string = type, does?: string) => {
    next = setAt(next, field, undefined);
    const dotted = field.join('.');
    warnings.push({ code: 'option-ignored', severity, field,
      message: `${dotted} has no effect on ${on} and is ignored.${does ? ` ${does}` : ''}`,
      suggest: `Remove ${dotted}.`, fix: [{ op: 'remove', path: toJsonPointer(field) }] });
  };
  for (const [path, { types, does }] of Object.entries(IGNORED_ON)) {
    const field = ['options', ...path.split('.')];
    const value = readAt(chart, field);
    // A sub-key the schema refuses keeps its refusal (valueAxis.break on a grid).
    const refused = isRecord(value) && path === 'valueAxis' && schemaRefusedKeys(type).valueAxis.some((key) => value[key] !== undefined);
    if (types.includes(type) && value !== undefined && !refused) ignore(field, 'warn', type, does);
  }
  // Most requests carry none of these settings: leave before any table is read.
  const currentOptions = readAt(next, ['options']) as Record<string, unknown>;
  const authored = Object.keys(currentOptions);
  if (!Object.hasOwn(chart, 'annotations') && !authored.some((key) => IGNORED_OPTION_KEYS.has(key) || VARIANT_SCOPED_KEYS.has(key) || key === 'valueAxis' || key === 'legend' || key === 'valueLabels')) return { chart: next as C, warnings };
  if (authored.some((key) => IGNORED_OPTION_KEYS.has(key))) {
    for (const key of schemaRefusedKeys(type).options) {
      if (IGNORED_OPTION_KEYS.has(key) && currentOptions[key] !== undefined) {
        const title = key === 'categoryAxis' && readAt(currentOptions[key], ['title']) !== undefined;
        ignore(['options', key], 'warn', type, title ? CATEGORY_AXIS_SUPPORT : undefined);
      }
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
  ignoreVariantSettings(type, chart, readAt(next, ['options']) as Record<string, unknown>, ignore);
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
  bartable: ['panels', 'cascade'],
  dot: ['dot', 'dumbbell', 'lollipop'],
  funnel: ['rows', 'centered'],
  heatmap: ['value', 'harvey', 'bubble'],
  line: ['line', 'area', 'stacked-area', 'stacked100-area', 'bump'],
  slope: ['lines', 'diverging'],
  waterfall: ['vertical', 'horizontal'],
};

function ignoreVariantSettings(type: string, chart: unknown, options: Record<string, unknown>, ignore: (field: string[], severity: 'warn' | 'info', on: string) => void): void {
  // The schema path accepts a variant in any case and runs this again after conversion, so it warns there. React reads the raw text and draws another layout.
  if (typeof options.variant === 'string' && VARIANT_NAMES[type] && !VARIANT_NAMES[type].includes(options.variant)) return;
  const name = readAt(chart, ['type']);
  const drop = (field: string[], variant: string) => ignore(field, 'warn', `${type} variant '${variant}'`);
  const set = (key: string) => options[key] !== undefined;
  const dropAll = (keys: readonly string[], variant: string) => { for (const key of keys) if (set(key)) drop(['options', key], variant); };
  // Root annotations enter the options only later in the request, so both places are read. An empty list draws what no list draws and warns nothing.
  const authored = (list: unknown) => Array.isArray(list) ? list.length > 0 : list !== undefined;
  const dropAnnotations = (variant: string) => {
    if (authored(options.annotations)) drop(['options', 'annotations'], variant);
    if (authored(readAt(chart, ['annotations']))) drop(['annotations'], variant);
  };
  const dropSegments = (variant: string) => { if (isRecord(options.sort) && options.sort.segments !== undefined) drop(['options', 'sort', 'segments'], variant); };
  if (type === 'cohort') {
    const variant = typeof options.variant === 'string' ? options.variant : 'heatmap';
    if (variant === 'heatmap') {
      dropAll(COHORT_EXHIBIT_ONLY, variant);
      // Sort.segments 'reverse' puts the newest cohort first, and the other reorderings would scramble the staircase.
      if (isRecord(options.sort)) {
        if (options.sort.categories !== undefined) drop(['options', 'sort', 'categories'], variant);
        if (options.sort.segments === 'asc' || options.sort.segments === 'desc') drop(['options', 'sort', 'segments'], variant);
      }
    }
    // false stays with its own refusal, which names the one variant that takes it.
    if (variant !== 'pure' && typeof options.designatedPeriod === 'number') drop(['options', 'designatedPeriod'], variant);
    if (variant !== 'heatmap' && set('averages')) drop(['options', 'averages'], variant);
    if (variant === 'pure') dropAll(['legend', 'formatScope'], variant);
  } else if (type === 'bar') {
    const variant = typeof options.variant === 'string' ? options.variant : 'grouped';
    if (variant !== 'tornado') dropAll(['tornado', 'baseValue'], variant);
    if (variant === 'tornado' || variant === 'football-field') {
      if (isRecord(options.topN) && options.topN.showRestCount !== undefined) drop(['options', 'topN', 'showRestCount'], variant);
      dropAnnotations(variant);
      dropSegments(variant);
    }
    if (variant === 'tornado') dropAll(['currentValue', 'connectors', 'netLine', 'grandTotalLabels', 'averageMarker'], variant);
    else if (variant === 'football-field') dropAll(['legend'], variant);
    else dropAll(['currentValue', ...(variant === 'grouped' ? ['connectors', 'netLine', 'grandTotalLabels'] : [])], variant);
  } else if (type === 'dot') {
    const variant = typeof options.variant === 'string' ? options.variant : name === 'dumbbell' || name === 'lollipop' ? name : 'dot';
    if (variant !== 'dumbbell') dropAll(['arrow', 'gapColumn'], variant);
  } else if (type === 'funnel') {
    if (options.variant === 'centered') dropAll(['worstDropCallout', 'bandFraction'], 'centered');
    else dropAll(['totalCvr', 'stageShade'], 'rows');
  } else if (type === 'slope') {
    if (options.variant === 'diverging') {
      dropAll(['legend'], 'diverging');
      dropAnnotations('diverging');
    } else dropAll(['diverging'], 'lines');
  } else if (type === 'waterfall') {
    // An omitted variant with annotations stays vertical, so only the named one has no part for them.
    if (options.variant === 'horizontal') dropAnnotations('horizontal');
  } else if (type === 'heatmap') {
    if (options.variant === 'harvey') dropAll(['cap'], 'harvey');
  } else if (type === 'bartable') {
    // 'sum-consistent' keeps its own refusal; under a cascade the share settings decide.
    if (options.variant !== 'cascade' && options.rounding === 'nearest') drop(['options', 'rounding'], typeof options.variant === 'string' ? options.variant : 'panels');
    // A share change needs no years: only a CAGR reads them.
    const growth = isRecord(options.cascade) && isRecord(options.cascade.growth) ? options.cascade.growth : undefined;
    if (growth?.measure === 'share-change' && growth.years !== undefined) ignore(['options', 'cascade', 'growth', 'years'], 'warn', "bartable growth measure 'share-change'");
  } else if (type === 'line') {
    const percent = isRecord(options.valueAxis) && options.valueAxis.percent;
    if (options.variant === 'stacked100-area' || (percent && options.variant !== 'bump')) dropAll(['rebase100'], 'stacked100-area');
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
  reportRetained = true,
): { chart: C; warnings: LintWarning[] } {
  let { next, warnings } = settlePanels(type, chart, (panelType, panel) => retireChartSettings(panelType, panel, canonical, reportRetained), canonical);
  for (const entry of [...RETIRED_SETTINGS, ...OWN_SETTINGS.get(type) ?? []]) {
    if (entry.types && !entry.types.includes(type)) continue;
    for (const path of [entry.at].flat()) for (const at of places(next, path.split('.'))) {
      const value = readAt(next, at);
      // An empty annotation list draws what no list draws: it goes without a warning.
      if (ANNOTATIONS_RETIRED.includes(type) && at.at(-1) === 'annotations' && Array.isArray(value) && value.length === 0) { next = setAt(next, at, undefined); continue; }
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
  // Keep the option in the request so the SVG id stays the same.
  const options = ignored.chart.options;
  if (reportRetained && type === 'waterfall' && isRecord(options) && options.variant === 'horizontal' && options.axisTitles !== undefined) {
    warnings.push({
      code: 'option-ignored', severity: 'warn', field: ['options', 'axisTitles'],
      message: 'options.axisTitles has no effect on a horizontal waterfall.',
      suggest: "Remove options.axisTitles or set options.variant to 'vertical' to show an axis title.",
    });
  }
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
