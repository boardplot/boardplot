import { literalColor } from './colorLiteral';
import type { Theme } from './types/theme';

const resolved = new WeakMap<object, object>();

/** Resolve colour tokens before HTML can paint them directly. Keep legacy tokens and object identity. */
export function themeColors(theme: Theme): Theme {
  const color = resolveColors(theme.color);
  const table = theme.table && resolveColors(theme.table);
  return color === theme.color && table === theme.table ? theme : { ...theme, color, ...(table ? { table } : {}) };
}

function resolveColors<T>(value: T): T {
  if (typeof value === 'string') {
    return (/^(?:oklch|hsla?|rgba?|var)\(/i.test(value.trim()) ? literalColor(value) ?? value : value) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const known = resolved.get(value);
  if (known) return known as T;
  let result: T = value;
  for (const [key, child] of Object.entries(value)) {
    const next = resolveColors(child);
    if (next === child) continue;
    if (result === value) result = (Array.isArray(value) ? [...value] : { ...value }) as T;
    (result as Record<string, unknown>)[key] = next;
  }
  // A caller may edit an unresolved object. Only frozen library-owned branches can be cached.
  if (Object.isFrozen(value)) resolved.set(value, result as object);
  return result;
}
