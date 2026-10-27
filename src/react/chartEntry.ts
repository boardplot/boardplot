/**
 * Structural registration for the per-chart React entries.
 *
 * A bare `import '../../core/charts/<type>'` is a side-effect-only import.
 * In the PACKED form every registration lands in a shared `dist/chunk-*.js`
 * whose path no intent-bearing "sideEffects" glob can name, and a bundler that
 * treats that chunk as side-effect-free drops the registration while keeping
 * the component — the consumer gets a package that renders nothing, with the
 * symptom appearing at their render call. A packed-consumer probe measured
 * the entire registered catalogue collapsing to zero with a much smaller bundle.
 *
 * So the registration is not left to metadata. `registeredType()` takes the
 * chart definition as a VALUE, registers it if the definition module's own
 * top-level `registerChart` call did not survive, and returns the type string
 * that the exported component is built from. The exported binding therefore
 * has a real data dependency on the definition object: no tree-shaker can keep
 * `WaterfallChart` and drop `waterfallDefinition`, and no tree-shaker can keep
 * the call and drop its effect. The chart modules do not register themselves.
 *
 * Idempotent by construction: `registerChart` throws on a duplicate type, so
 * the `getChart` probe is what makes this safe to call whether or not the
 * definition module's own registration survived the bundler.
 */

import { getChart, registerChart, type ChartCore } from '../core/registry';

// The registry stores definitions with erased generics; entries pass through
// their own concrete definitions, so this alias is the widest honest type.
type AnyChartCore = ChartCore<any, any, any, any>;

/** Registers `definition` if it is not registered yet and returns its type. */
export function registeredType(core: AnyChartCore): string {
  if (!getChart(core.type)) registerChart(core);
  return core.type;
}

/**
 * Returns `value` unchanged after forcing `ensured` to be evaluated. For
 * entries whose component is not built from a type string (`table` renders
 * straight from `resolveTable`) this is what gives the exported binding a real
 * dependency on the registration.
 */
export function withRegistered<T>(value: T, ...ensured: string[]): T {
  if (ensured.length === 0) throw new Error('withRegistered needs at least one registered type');
  return value;
}
