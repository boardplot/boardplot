/** Numeric table fitting keeps scene construction behind the selected plan. */
import { copyFrame, footerPlans } from './footer';
import { emptyIdRecord } from './idRecords';
import type { FrameGeometry, Geometry } from './types/scene';

type AnyGeometry = Geometry<object, object>;

export const PLAN_ONLY = Symbol('tablePlanOnly');
const PLAN = Symbol('tableLayoutPlan');
type Plan = { draw: () => AnyGeometry; warnings: number; cuts: number; rendered?: AnyGeometry };
type Planned = { [PLAN]?: Plan };

export function deferLayout<G extends AnyGeometry>(geometry: G, draw: () => G, cuts: number): G {
  (geometry as G & Planned)[PLAN] = { draw, cuts, warnings: geometry.warnings.length };
  return geometry;
}

export function isPlanned(value: object): boolean { return (value as Planned)[PLAN] !== undefined; }
export function plannedCutCount(value: AnyGeometry): number | undefined { return (value as Planned)[PLAN]?.cuts; }
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

