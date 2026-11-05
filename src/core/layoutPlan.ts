/** Numeric table fitting keeps scene construction behind the selected plan. */
import { copyFrame, footerPlans } from './footer';
import { emptyIdRecord } from './idRecords';
import { currentSmallValues } from './formatPrecision';
import type { FontSpec, TextMeasurer, TextSize } from './text';
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
type Inputs = { json: WeakMap<object, string>; texts: WeakMap<TextMeasurer, FontPlans> };
let inputs: Inputs | undefined;

/** Synchronous probes share snapshots; the next public call reads mutable inputs again. */
export function withPlanInputs<T>(run: () => T): T {
  if (inputs) return run();
  inputs = { json: new WeakMap(), texts: new WeakMap() };
  try { return run(); } finally { inputs = undefined; }
}

function inputJson(value: object): string {
  let key = inputs?.json.get(value);
  if (key === undefined) { key = JSON.stringify(value, keyFunction); inputs?.json.set(value, key); }
  return key;
}

/** Data and theme snapshots are shared only during one synchronous request, including nested mutable fields. */
export function layoutKey(data: object, options: object): string {
  const { theme, ...rest } = options as { theme?: unknown };
  const symbols = Object.getOwnPropertySymbols(options).map(symbol => [symbol.description, (options as Record<symbol, unknown>)[symbol]]);
  return JSON.stringify([inputJson(data), rest, theme && typeof theme === 'object' ? inputJson(theme) : theme, symbols, currentSmallValues()], keyFunction);
}

const measurers = new WeakMap<TextMeasurer, TextMeasurer>();
const wrappedMeasurers = new WeakSet<TextMeasurer>();
const sameFont = (a: FontSpec, b: FontSpec) => a.family === b.family && a.size === b.size && a.weight === b.weight && a.style === b.style
  && a.letterSpacing === b.letterSpacing && a.tabular === b.tabular && a.lineHeight === b.lineHeight;

/** A distinct string is measured once per complete font during a numeric fit. No rounding is introduced. */
export function tableTextMeasure(raw: TextMeasurer): TextMeasurer {
  if (wrappedMeasurers.has(raw)) return raw;
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
  for (const key of Reflect.ownKeys(value)) copy[key] = copyPlannedValue((value as Record<PropertyKey, unknown>)[key], copies);
  return copy as T;
}

