import { toJsonPointer } from './diagnostics/jsonPatch';
import type { LintWarning } from './types/scene';

/** An exact spelling wins; an unknown spelling needs one case-insensitive match. */
export function caseInsensitiveValue(value: unknown, allowed: readonly unknown[]): string | undefined {
  if (typeof value !== 'string' || allowed.includes(value)) return undefined;
  const matches = [...new Set(allowed.filter((entry): entry is string => typeof entry === 'string' && entry.toLowerCase() === value.toLowerCase()))];
  return matches.length === 1 ? matches[0] : undefined;
}

/** A conversion states the authored value and writes the value the chart uses. */
export function inputConversion(field: readonly (string | number)[], from: unknown, to: unknown): LintWarning {
  const source = typeof from === 'string' ? `the text ${JSON.stringify(from)}` : `the number ${from}`;
  const target = typeof to === 'number' ? `the number ${to}` : typeof to === 'boolean' ? `the boolean ${to}` : JSON.stringify(to);
  return {
    code: 'input-converted', severity: 'info', field,
    message: `${field.join('.')}: ${source} is ${typeof to === 'string' ? 'drawn as' : 'read as'} ${target}`,
    fix: [{ op: 'replace', path: toJsonPointer(field), value: to }],
  };
}

/** Copy only the authored path, preserving prototypes and symbol marks. */
export function replaceInputValue<T>(input: T, path: readonly (string | number)[], value: unknown): T {
  if (!path.length) return value as T;
  const [key, ...rest] = path;
  const copy = Array.isArray(input) ? [...input] : Object.create(Object.getPrototypeOf(input));
  if (!Array.isArray(input)) {
    for (const own of Reflect.ownKeys(input as object)) {
      if (own !== String(key)) Object.defineProperty(copy, own, Object.getOwnPropertyDescriptor(input, own)!);
    }
  }
  Object.defineProperty(copy, key!, { value: replaceInputValue((input as Record<string | number, unknown>)[key!], rest, value), enumerable: true, configurable: true, writable: true });
  return copy;
}
