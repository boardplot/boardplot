import type { useZoom } from './useZoom';

/** The zoom hook a chart component is built with: `useZoom` for the one type that zooms, `noZoom` for the others. */
export type ZoomHook = typeof useZoom;

const ignore = () => {};

/** A chart that cannot zoom draws the spec as given. Fixed per component, so the hook order never changes. */
export const noZoom: ZoomHook = (input) => ({
  active: false, derived: false, data: input.data, options: input.options, annotations: input.annotations, attach: ignore, seen: ignore,
});

/** type -> its zoom hook, set by the entry of a type that zooms. */
const hooks = new Map<string, ZoomHook>();

/**
 * Called by the entry of a type that zooms (line) with its hook, which it passes on to its component. The return
 * value is the hook, so no bundler can keep the component and drop the call. `BoardplotChart` builds its component
 * for that type from the hook set here.
 */
export function linkZoom(type: string, hook: ZoomHook): ZoomHook {
  hooks.set(type, hook);
  return hook;
}

/** The zoom hook of a type whose entry this page has loaded, or undefined. */
export function zoomHookFor(type: string): ZoomHook | undefined {
  return hooks.get(type);
}

/** The language of a locale given as a tag ('de') or as `{ language }`. */
export const languageOf = (locale: unknown): string | undefined =>
  typeof locale === 'string' ? locale : (locale as { language?: string } | undefined)?.language;
