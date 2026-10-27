import type { DeferredName } from '../core/deferred';

/** Component -> how to build it again for an entry that links more fetched modules. */
const rebinders = new WeakMap<object, (linked: readonly DeferredName[]) => unknown>();

/** Called by the component factories: records how `component` is built with another `linked` list. */
export function rebindable(component: object, rebind: (linked: readonly DeferredName[]) => unknown): void {
  rebinders.set(component, rebind);
}

/**
 * The same component, built for an entry that links `linked` (`boardplot/react`
 * links every fetched module, so its server and hydrating frames may use them).
 */
export function linkedBinding<C extends object>(component: C, linked: readonly DeferredName[]): C {
  const rebind = rebinders.get(component);
  if (rebind === undefined) throw new Error('linkedBinding: this component was not built by a chart component factory');
  return rebind(linked) as C;
}
