/** Numeric table fitting keeps scene construction behind the selected plan. */
import { copyFrame, footerPlans } from './footer';
import { emptyIdRecord } from './idRecords';
import { currentSmallValues } from './formatPrecision';
import { isCachedTextMeasurer, type FontSpec, type TextMeasurer, type TextSize } from './text';
import type { FrameGeometry, Geometry } from './types/scene';

type AnyGeometry = Geometry<object, object>;

const functionIds = new WeakMap<object, number>();
let nextFunctionId = 0;
const keyFunction = (_key: string, value: unknown): unknown => {
  if (typeof value !== 'function') return value;
  if (!functionIds.has(value)) functionIds.set(value, nextFunctionId++);
  return `function ${functionIds.get(value)}`;
};
type TextPlan = { font: FontSpec; texts: Map<string, TextSize> };
type FontPlans = { families: Map<FontSpec['family'], Map<number, TextPlan[]>>; last?: TextPlan };
type InputKeyReader = (value: object) => string | undefined;
type Inputs = { json: WeakMap<object, string>; themes: WeakMap<object, number>; texts: WeakMap<TextMeasurer, FontPlans>; exactKeys?: Map<InputKeyReader, WeakMap<object, string | undefined>> };
let inputs: Inputs | undefined;

/** Synchronous probes share snapshots; the next public call reads mutable inputs again. */
export function withPlanInputs<T>(run: () => T): T {
  if (inputs) return run();
  inputs = { json: new WeakMap(), themes: new WeakMap(), texts: new WeakMap() };
  try { return run(); } finally { inputs = undefined; }
}

/** Size probes share an exact input snapshot. A new public request checks mutable inputs again. */
export function memoExactInputKey(value: object, read: InputKeyReader): string | undefined {
  if (!inputs) return read(value);
  const readers = inputs.exactKeys ??= new Map();
  let keys = readers.get(read);
  if (!keys) readers.set(read, keys = new WeakMap());
  if (keys.has(value)) return keys.get(value);
  const key = read(value);
  keys.set(value, key);
  return key;
}

function inputJson(value: object): string {
  let key = inputs?.json.get(value);
  if (key === undefined) { key = JSON.stringify(value, keyFunction); inputs?.json.set(value, key); }
  return key;
}

const inputVersions = new WeakMap<object, { json: string; version: number }>();
const ownedInputVersions = new WeakMap<object, number>();
let nextInputVersion = 0;

/** A completed private model that callers only receive through a deep copy. Never mark caller inputs. */
export function ownPlanInput(value: object): void {
  if (!ownedInputVersions.has(value)) ownedInputVersions.set(value, nextInputVersion++);
}

function inputVersion(value: object): number {
  const owned = ownedInputVersions.get(value);
  if (owned !== undefined) return owned;
  const json = inputJson(value);
  let known = inputVersions.get(value);
  if (!known || known.json !== json) inputVersions.set(value, known = { json, version: nextInputVersion++ });
  return known.version;
}

const themeVersions = new Map<string, number>();
let nextThemeVersion = 0;

/** Fresh wrappers with equal theme content share a key; a new request still checks mutable fields. */
function themeVersion(theme: object): number {
  let version = inputs?.themes.get(theme);
  if (version !== undefined) return version;
  const json = inputJson(theme);
  version = themeVersions.get(json);
  if (version === undefined) {
    if (themeVersions.size >= 256) themeVersions.delete(themeVersions.keys().next().value!);
    themeVersions.set(json, version = nextThemeVersion++);
  }
  inputs?.themes.set(theme, version);
  return version;
}

/** Reuse nested option snapshots during one request without escaping their JSON again. */
export function optionKey(options: object): string {
  const valueKey = (value: unknown): string | undefined => value !== null && typeof value === 'object'
    ? inputJson(value) : JSON.stringify(value, keyFunction);
  const fields: string[] = [];
  for (const key of Object.keys(options)) {
    if (key === 'theme') continue;
    const value = valueKey((options as Record<string, unknown>)[key]);
    if (value !== undefined) fields.push(JSON.stringify(key) + ':' + value);
  }
  const theme = (options as { theme?: unknown }).theme;
  const symbols = Object.getOwnPropertySymbols(options).map(symbol =>
    '[' + (JSON.stringify(symbol.description) ?? 'null') + ',' + (valueKey((options as Record<symbol, unknown>)[symbol]) ?? 'null') + ']');
  return '[{' + fields.join(',') + '},' + (valueKey(theme && typeof theme === 'object' ? themeVersion(theme) : theme) ?? 'null')
    + ',[' + symbols.join(',') + '],' + JSON.stringify(currentSmallValues()) + ']';
}

/** Public data is checked by content once per request. Private model caches already own their data identity. */
export function layoutKey(data: object, options: object): string {
  return inputVersion(data) + ':' + optionKey(options);
}

const measurers = new WeakMap<TextMeasurer, TextMeasurer>();
const wrappedMeasurers = new WeakSet<TextMeasurer>();
const sameFont = (a: FontSpec, b: FontSpec) => a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
  && a.letterSpacing === b.letterSpacing && a.tabular === b.tabular && a.lineHeight === b.lineHeight;

/** A distinct string is measured once per complete font during a numeric fit. No rounding is introduced. */
export function tableTextMeasure(raw: TextMeasurer): TextMeasurer {
  if (isCachedTextMeasurer(raw) || wrappedMeasurers.has(raw)) return raw;
  let wrapped = measurers.get(raw);
  if (!wrapped) {
    wrapped = (text, font) => {
      if (!inputs) return raw(text, font);
      let fonts = inputs.texts.get(raw);
      if (!fonts) inputs.texts.set(raw, fonts = { families: new Map() });
      let plan = fonts.last;
      if (!plan || !sameFont(plan.font, font)) {
        let family = fonts.families.get(font.family);
        if (!family) fonts.families.set(font.family, family = new Map());
        const key = font.size * 4096 + font.weight;
        let variants = family.get(key);
        if (!variants) family.set(key, variants = []);
        plan = variants.find(candidate => sameFont(candidate.font, font));
        if (!plan) { plan = { font: { ...font }, texts: new Map() }; variants.push(plan); }
        fonts.last = plan;
      }
      let result = plan.texts.get(text);
      if (!result) plan.texts.set(text, result = { ...raw(text, font) });
      return result;
    };
    Object.defineProperty(wrapped, 'capHeight', { get: () => raw.capHeight });
    measurers.set(raw, wrapped);
    wrappedMeasurers.add(wrapped);
  }
  return wrapped;
}

export const PLAN_ONLY = Symbol('tablePlanOnly');
const PLAN = Symbol('tableLayoutPlan');
type Plan = { draw: () => AnyGeometry; warnings: number; cuts: number | (() => number); rendered?: AnyGeometry };
type Planned = { [PLAN]?: Plan };

export function deferLayout<G extends AnyGeometry>(geometry: G, draw: () => G, cuts: number | (() => number)): G {
  (geometry as G & Planned)[PLAN] = { draw, cuts, warnings: geometry.warnings.length };
  return geometry;
}

export function isPlanned(value: object): boolean { return (value as Planned)[PLAN] !== undefined; }
export function plannedCutCount(value: AnyGeometry): number | undefined {
  const plan = (value as Planned)[PLAN];
  if (typeof plan?.cuts === 'function') plan.cuts = plan.cuts();
  return plan?.cuts;
}
export function transferLayout<G extends object>(source: object, target: G): G {
  const plan = (source as Planned)[PLAN];
  if (plan) (target as G & Planned)[PLAN] = plan;
  return target;
}

/** Scene fields are owned by the caller; fitting metadata may have changed after the plan was selected. */
export function materializeLayout<G extends AnyGeometry>(geometry: G): G {
  const plan = (geometry as G & Planned)[PLAN];
  if (!plan) return geometry;
  const drawn = plan.rendered ??= plan.draw();
  const result = {
    ...geometry, scene: drawn.scene, marks: drawn.marks, debug: drawn.debug,
    labels: drawn.labels, axes: drawn.axes, annotations: drawn.annotations,
    warnings: [...geometry.warnings.slice(0, plan.warnings), ...drawn.warnings.slice(plan.warnings), ...geometry.warnings.slice(plan.warnings)],
    ...(drawn.paintWarningRules === undefined ? {} : { paintWarningRules: drawn.paintWarningRules }),
  } as G & Planned;
  delete result[PLAN];
  return copyPlannedValue(result);
}

/** Copy shared fonts and cells once per result. A copy of every array, Map, Set and plain object; a function and any other value is shared (the compiled options hold the measurer). */
export function copyPlannedValue<T>(value: T, copies = new Map<object, unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  const known = copies.get(value);
  if (known !== undefined) return known as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const entry of value) copy.push(copyPlannedValue(entry, copies));
    return copy as T;
  }
  if (value instanceof Map) {
    const copy = new Map();
    copies.set(value, copy);
    for (const [key, entry] of value) copy.set(key, copyPlannedValue(entry, copies));
    return copy as T;
  }
  if (value instanceof Set) {
    const copy = new Set();
    copies.set(value, copy);
    for (const entry of value) copy.add(copyPlannedValue(entry, copies));
    return copy as T;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  // A null-prototype record (cells keyed by column id) stays one, so a column named __proto__ keeps its cell.
  const copy: Record<PropertyKey, unknown> = footerPlans.has(value as FrameGeometry)
    ? copyFrame(value as FrameGeometry) as Record<PropertyKey, unknown> : Object.getPrototypeOf(value) === null ? emptyIdRecord() : {};
  copies.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    const entry = copyPlannedValue((value as Record<PropertyKey, unknown>)[key], copies);
    // Note metadata stays outside a note's public fields, also on the copy a caller receives.
    if (typeof key === 'symbol' && !Object.prototype.propertyIsEnumerable.call(value, key)) Object.defineProperty(copy, key, { value: entry, configurable: true });
    else if (key === '__proto__') Object.defineProperty(copy, key, { value: entry, enumerable: true, writable: true, configurable: true });
    else copy[key] = entry;
  }
  return copy as T;
}

const requestResults = new WeakMap<object, Map<string, unknown>>();

/**
 * One public table layout. A host that lays out again on stable data reads the stored result, and the
 * result it receives is a copy, so a caller's edits never reach a later one. The key reads the data,
 * the options and the resolved request fields again on each call, so an edit lays out again.
 * shortcut: retain 32 results per data object; a new result replaces the oldest.
 */
export function repeatedResult<T>(data: object, options: object, resolved: object, layout: () => T): T {
  return withPlanInputs(() => {
    const key = `${layoutKey(data, options)}:${inputJson(resolved)}`;
    let byKey = requestResults.get(data);
    if (!byKey) requestResults.set(data, byKey = new Map());
    if (byKey.size >= 32 && !byKey.has(key)) byKey.delete(byKey.keys().next().value!);
    if (!byKey.has(key)) byKey.set(key, layout());
    return copyPlannedValue(byKey.get(key)) as T;
  });
}
